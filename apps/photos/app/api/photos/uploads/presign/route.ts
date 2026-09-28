import { randomBytes, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PhotoUpload } from "@xenode/database";
import { requirePhotoMedia } from "@xenode/media-processing";
import { assertSpaceAction, personalSpaceId, resolveSpaceAccess } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

const MAX_DIRECT_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_DERIVATIVE_BYTES = 25 * 1024 * 1024;

type UploadVariant = {
  objectKey: string;
  uploadUrl: string;
};

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const fileSize = Number(body?.fileSize);
  const contentType =
    typeof body?.mediaType === "string" ? body.mediaType : "";
  const optimizedSize = Number(body?.optimizedSize);
  const thumbnailSize = Number(body?.thumbnailSize);
  let mediaType: "image" | "video";
  try {
    mediaType = requirePhotoMedia(contentType);
  } catch {
    return Response.json(
      { error: "Photos accepts only images and videos" },
      { status: 400 },
    );
  }
  if (
    typeof body?.assetId !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(body.assetId) ||
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 16 ||
    fileSize > MAX_DIRECT_UPLOAD_BYTES + 16
  ) {
    return Response.json(
      { error: "Invalid file size or file exceeds the 250 MB web limit" },
      { status: 400 },
    );
  }
  if (
    mediaType === "image" &&
    (!Number.isSafeInteger(optimizedSize) ||
      optimizedSize <= 16 ||
      optimizedSize > MAX_DERIVATIVE_BYTES ||
      !Number.isSafeInteger(thumbnailSize) ||
      thumbnailSize <= 16 ||
      thumbnailSize > MAX_DERIVATIVE_BYTES)
  ) {
    return Response.json(
      { error: "Images require valid optimized and thumbnail sizes" },
      { status: 400 },
    );
  }

  try {
    const spaceId = personalSpaceId(session.accountId);
    const access = await resolveSpaceAccess({
      accountId: session.accountId, spaceId, productId: "photos",
    });
    assertSpaceAction(access, "write");
    const storage = await getPhotosStorageContext(session.accountId);
    await PhotoUpload.init();
    const assetId = body.assetId as string;
    let manifest = await PhotoUpload.findOne({ spaceId, assetId });
    if (!manifest) {
      try {
        manifest = await PhotoUpload.create({
          uploadId: randomUUID(), assetId, accountId: session.accountId,
          spaceId, bucketId: storage.bucket._id, mediaType,
          original: { key: newObjectKey(session.accountId), size: fileSize },
          ...(mediaType === "image" ? {
            optimized: { key: newObjectKey(session.accountId), size: optimizedSize },
            thumbnail: { key: newObjectKey(session.accountId), size: thumbnailSize },
          } : {}),
          status: "pending",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        manifest = await PhotoUpload.findOne({ spaceId, assetId });
      }
    }
    if (
      !manifest || manifest.accountId !== session.accountId ||
      String(manifest.bucketId) !== String(storage.bucket._id) ||
      manifest.status !== "pending" || manifest.expiresAt <= new Date() ||
      manifest.mediaType !== mediaType || manifest.original.size !== fileSize ||
      (mediaType === "image" &&
        (manifest.optimized?.size !== optimizedSize ||
          manifest.thumbnail?.size !== thumbnailSize))
    ) {
      return Response.json({ error: "Photo upload reservation conflict" }, { status: 409 });
    }
    const renewed = await PhotoUpload.findOneAndUpdate(
      { _id: manifest._id, status: "pending", expiresAt: { $gt: new Date() } },
      { $set: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } },
      { returnDocument: "after" },
    );
    if (!renewed) {
      return Response.json({ error: "Photo upload is no longer pending" }, { status: 409 });
    }
    manifest = renewed;
    const original = await signVariant(manifest.original.key, storage);
    const optimized = manifest.optimized
      ? await signVariant(manifest.optimized.key, storage) : undefined;
    const thumbnail = manifest.thumbnail
      ? await signVariant(manifest.thumbnail.key, storage) : undefined;
    return Response.json({
      uploadId: manifest.uploadId,
      original,
      optimized,
      thumbnail,
      bucketId: storage.bucket._id.toString(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not prepare upload",
      },
      { status: 500 },
    );
  }
}

function newObjectKey(accountId: string): string {
  return `users/${accountId}/${randomBytes(16).toString("hex")}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return error !== null && typeof error === "object" &&
    "code" in error && error.code === 11000;
}

async function signVariant(
  objectKey: string,
  storage: Awaited<ReturnType<typeof getPhotosStorageContext>>,
): Promise<UploadVariant> {
  const uploadUrl = await getSignedUrl(
    storage.client,
    new PutObjectCommand({
      Bucket: storage.bucket.b2BucketId,
      Key: objectKey,
      ContentType: "application/octet-stream",
    }),
    { expiresIn: 3600 },
  );
  return { objectKey, uploadUrl };
}
