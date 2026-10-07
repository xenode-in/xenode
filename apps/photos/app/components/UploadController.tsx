"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@xenode/ui";
import { useProductCrypto } from "@xenode/crypto-react";
import { PhotosUploadPolicy } from "@xenode/photos";
import {
  UploadEngine,
  createMemoryCheckpointStore,
  type UploadInput,
  WRITE_ONCE_PUT_HEADERS,
  NonRetryableUploadError,
} from "@xenode/upload-engine";
import { getClientPhotosSession } from "@/lib/client-session";
import { createImageDerivatives } from "@/lib/image-derivatives";
import { fileCiphertextBytes } from "@xenode/crypto-core";
import { encryptPhotoFile, encryptPhotoVideo } from "@/lib/photo-encryption";
import { sealPhotoName } from "@/lib/album-name";
import { usePhotosMetadataKey } from "./PhotosKeyAccess";

const MAX_WEB_UPLOAD_BYTES = 250 * 1024 * 1024;
const sizeOf = (body: ArrayBuffer | Blob) => body instanceof Blob ? body.size : body.byteLength;

export function UploadController({
  spaceId,
  onUploaded,
}: {
  spaceId: string;
  onUploaded(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const productCrypto = useProductCrypto();
  const metadataKey = usePhotosMetadataKey(spaceId);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  async function upload(files: File[]) {
    if (!spaceId || files.length === 0) return;
    setUploading(true);
    setStatus(`Preparing ${files.length} ${files.length === 1 ? "item" : "items"}`);

    const policy = new PhotosUploadPolicy({
      async extract(source) {
        if (!source.type.startsWith("image/")) return {};
        const bitmap = await createImageBitmap(source);
        try {
          return { width: bitmap.width, height: bitmap.height };
        } finally {
          bitmap.close();
        }
      },
      async createEncryptedPreview() {
        return undefined;
      },
    });

    let completed = 0;
    const engine = new UploadEngine(
      {
        async upload(input, _checkpoint, signal) {
          if (!(input.source instanceof File)) {
            throw new Error("Invalid photo upload source");
          }
          if (input.size > MAX_WEB_UPLOAD_BYTES) {
            throw new Error(`${input.name} exceeds the 250 MB web upload limit`);
          }
          const preparation = policy.takePreparation(input.id);
          setStatus(`Optimizing ${input.name}`);
          const derivatives =
            preparation.mediaType === "image"
              ? await createImageDerivatives(input.source)
              : undefined;
          const session = await getClientPhotosSession();
          const presignResponse = await fetch("/api/photos/uploads/presign", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              assetId: input.id,
              // Videos are sealed in chunks (one tag each) so they can stream.
              fileSize:
                preparation.mediaType === "video"
                  ? fileCiphertextBytes(preparation.uploadSource.size)
                  : preparation.uploadSource.size + 16,
              mediaType: input.contentType,
              optimizedSize: derivatives
                ? derivatives.optimized.blob.size + 16
                : undefined,
              thumbnailSize: derivatives
                ? derivatives.thumbnail.blob.size + 16
                : undefined,
            }),
            signal,
          });
          type UploadVariant = {
            objectKey: string;
            uploadUrl: string;
          };
          const presign = (await presignResponse.json().catch(() => ({}))) as {
            error?: string;
            uploadId?: string;
            bucketId?: string;
            optimized?: UploadVariant;
            original?: UploadVariant;
            thumbnail?: UploadVariant;
          };
          if (
            !presignResponse.ok ||
            !presign.original ||
            !presign.uploadId ||
            !presign.bucketId
          ) {
            throw new Error(presign.error ?? "Could not prepare photo upload");
          }
          if (
            preparation.mediaType === "image" &&
            (!presign.optimized || !presign.thumbnail)
          ) {
            throw new Error("Could not prepare image derivatives");
          }

          setStatus(`Encrypting ${input.name}`);
          const encrypted = await productCrypto.withProductKey(
            spaceId,
            async (productSpaceKey) => ({
              original: await (preparation.mediaType === "video" ? encryptPhotoVideo : encryptPhotoFile)(
                preparation.uploadSource,
                productSpaceKey,
                {
                  accountId: session.accountId,
                  spaceId,
                  objectKey: presign.original!.objectKey,
                },
              ),
              optimized:
                derivatives && presign.optimized
                  ? await encryptPhotoFile(
                      derivatives.optimized.blob,
                      productSpaceKey,
                      {
                        accountId: session.accountId,
                        spaceId,
                        objectKey: presign.optimized.objectKey,
                      },
                    )
                  : undefined,
              thumbnail:
                derivatives && presign.thumbnail
                  ? await encryptPhotoFile(
                      derivatives.thumbnail.blob,
                      productSpaceKey,
                      {
                        accountId: session.accountId,
                        spaceId,
                        objectKey: presign.thumbnail.objectKey,
                      },
                    )
                  : undefined,
            }),
          );

          const uploadVariants = [
            { signed: presign.original, encrypted: encrypted.original },
            ...(presign.optimized && encrypted.optimized
              ? [{ signed: presign.optimized, encrypted: encrypted.optimized }]
              : []),
            ...(presign.thumbnail && encrypted.thumbnail
              ? [{ signed: presign.thumbnail, encrypted: encrypted.thumbnail }]
              : []),
          ];
          try {
            setStatus(`Uploading ${input.name}`);
            await Promise.all(
              uploadVariants.map(async ({ signed, encrypted: variant }) => {
                const response = await fetch(signed.uploadUrl, {
                  method: "PUT",
                  headers: { "content-type": "application/octet-stream", ...WRITE_ONCE_PUT_HEADERS },
                  credentials: "omit",
                  body: variant.body,
                  signal,
                });
                if (!response.ok) {
                  if (response.status === 412) {
                    throw new NonRetryableUploadError("This upload could not be resumed safely. Select the file again to restart.");
                  }
                  throw new Error(`R2 upload failed (${response.status})`);
                }
              }),
            );

            const completeResponse = await fetch(
              "/api/photos/uploads/complete",
              {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  uploadId: presign.uploadId,
                  assetId: input.id,
                  bucketId: presign.bucketId,
                  objectKey: presign.original.objectKey,
                  size: sizeOf(encrypted.original.body),
                  originalContentType: input.contentType,
                  mediaType: preparation.mediaType,
                  encryptedDEK: encrypted.original.encryptedDEK,
                  iv: encrypted.original.iv,
                  spaceKeyWrapIv: encrypted.original.spaceKeyWrapIv,
                  ...("chunkIvs" in encrypted.original && {
                    chunkSize: encrypted.original.chunkSize,
                    chunkIvs: encrypted.original.chunkIvs,
                  }),
                  encryptedMetadata: metadataKey
                    ? await sealPhotoName(input.name, input.id, metadataKey, session.accountId, spaceId)
                    : undefined,
                  optimizedKey: presign.optimized?.objectKey,
                  optimizedSize: encrypted.optimized && sizeOf(encrypted.optimized.body),
                  optimizedContentType: derivatives?.optimized.contentType,
                  optimizedEncryptedDEK: encrypted.optimized?.encryptedDEK,
                  optimizedIV: encrypted.optimized?.iv,
                  optimizedSpaceKeyWrapIv:
                    encrypted.optimized?.spaceKeyWrapIv,
                  thumbnailKey: presign.thumbnail?.objectKey,
                  thumbnailSize: encrypted.thumbnail && sizeOf(encrypted.thumbnail.body),
                  thumbnailContentType: derivatives?.thumbnail.contentType,
                  thumbnailEncryptedDEK: encrypted.thumbnail?.encryptedDEK,
                  thumbnailIV: encrypted.thumbnail?.iv,
                  thumbnailSpaceKeyWrapIv:
                    encrypted.thumbnail?.spaceKeyWrapIv,
                  takenAt: new Date(
                    input.source.lastModified || Date.now(),
                  ).toISOString(),
                  width: preparation.metadata.width,
                  height: preparation.metadata.height,
                }),
                signal,
              },
            );
            const completedUpload = (await completeResponse
              .json()
              .catch(() => ({}))) as { error?: string; asset?: unknown };
            if (!completeResponse.ok) {
              throw new Error(
                completedUpload.error ?? "Could not save uploaded photo",
              );
            }
            completed += 1;
            setStatus(`Uploaded ${completed} of ${files.length}`);
            return completedUpload.asset;
          } catch (error) {
            void fetch("/api/photos/uploads/abort", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ uploadId: presign.uploadId }),
              keepalive: true,
            }).catch(() => {});
            setStatus("Upload failed");
            throw error;
          }
        },
      },
      policy,
      createMemoryCheckpointStore(),
      { concurrency: 3, maxAttempts: 2 },
    );

    const inputs: UploadInput[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      contentType: file.type,
      source: file,
    }));
    const results = await Promise.all(inputs.map((input) => engine.enqueue(input)));
    const failed = results.filter((result) => result.status !== "completed");
    setUploading(false);
    if (failed.length) {
      setStatus(
        failed.length === files.length
          ? failed[0]?.error?.message ?? "Upload failed"
          : `${completed} uploaded, ${failed.length} failed`,
      );
      return;
    }
    setStatus(`${completed} uploaded`);
    onUploaded();
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-2">
      {status ? (
        <span
          role="status"
          className="hidden max-w-52 items-center gap-1.5 truncate text-xs text-muted-foreground lg:flex"
        >
          {uploading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
          )}
          {status}
        </span>
      ) : null}
      <Button
        type="button"
        className="rounded-full px-5 shadow-sm shadow-primary/15"
        disabled={uploading || !spaceId}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        {uploading ? "Uploading" : "Add photos"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          const accepted = files.filter(
            (file) =>
              (file.type.startsWith("image/") ||
                file.type.startsWith("video/")) &&
              file.size > 0,
          );
          if (accepted.length !== files.length) {
            setStatus("Photos accepts non-empty images and videos only");
          }
          void upload(accepted);
        }}
      />
    </div>
  );
}
