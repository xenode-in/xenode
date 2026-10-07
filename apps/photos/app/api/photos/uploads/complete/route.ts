import { HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  PhotoAsset, PhotoUpload, PhotoUploadCommitError, commitPhotoUpload, getMongoose,
} from "@xenode/database";
import { personalSpaceId, resolveSpaceAccess } from "@xenode/spaces";
import { isSealedPhotoMetadata } from "@xenode/photos";
import { FILE_CHUNK_BYTES, fileChunkRange, fileCiphertextBytes } from "@xenode/crypto-core";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

const MAX_ENCRYPTED_UPLOAD_BYTES = fileCiphertextBytes(250 * 1024 * 1024);
const MAX_ENCRYPTED_DERIVATIVE_BYTES = 25 * 1024 * 1024 + 16;

type CompleteBody = {
  uploadId?: unknown;
  assetId?: unknown;
  bucketId?: unknown;
  chunkIvs?: unknown;
  chunkSize?: unknown;
  encryptedDEK?: unknown;
  encryptedMetadata?: unknown;
  height?: unknown;
  iv?: unknown;
  mediaType?: unknown;
  objectKey?: unknown;
  optimizedContentType?: unknown;
  optimizedEncryptedDEK?: unknown;
  optimizedIV?: unknown;
  optimizedKey?: unknown;
  optimizedSize?: unknown;
  optimizedSpaceKeyWrapIv?: unknown;
  originalContentType?: unknown;
  size?: unknown;
  spaceKeyWrapIv?: unknown;
  takenAt?: unknown;
  thumbnailContentType?: unknown;
  thumbnailEncryptedDEK?: unknown;
  thumbnailIV?: unknown;
  thumbnailKey?: unknown;
  thumbnailSize?: unknown;
  thumbnailSpaceKeyWrapIv?: unknown;
  width?: unknown;
};

type EncryptedVariant = {
  contentType: string;
  encryptedDEK: string;
  iv: string;
  key: string;
  size: number;
  spaceKeyWrapIv: string;
};

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CompleteBody | null;
  const takenAt =
    typeof body?.takenAt === "string" ? new Date(body.takenAt) : null;
  const original = body
    ? parseVariant(body, "", MAX_ENCRYPTED_UPLOAD_BYTES)
    : null;
  const optimized = body
    ? parseVariant(body, "optimized", MAX_ENCRYPTED_DERIVATIVE_BYTES)
    : null;
  const thumbnail = body
    ? parseVariant(body, "thumbnail", MAX_ENCRYPTED_DERIVATIVE_BYTES)
    : null;
  const isImage = body?.mediaType === "image";
  const layout = body && original ? chunkLayout(body, original.size) : null;
  if (
    !body ||
    typeof body.uploadId !== "string" ||
    !body.uploadId ||
    typeof body.assetId !== "string" ||
    !body.assetId ||
    typeof body.bucketId !== "string" ||
    !getMongoose().Types.ObjectId.isValid(body.bucketId) ||
    !original ||
    !takenAt ||
    Number.isNaN(takenAt.getTime()) ||
    (body.mediaType !== "image" && body.mediaType !== "video") ||
    (isImage &&
      (!original.contentType.startsWith("image/") ||
        !optimized ||
        optimized.contentType !== "image/jpeg" ||
        !thumbnail ||
        thumbnail.contentType !== "image/jpeg")) ||
    (body.mediaType === "video" &&
      !original.contentType.startsWith("video/")) ||
    layout === "invalid" ||
    (body.encryptedMetadata !== undefined &&
      !isSealedPhotoMetadata(body.encryptedMetadata, personalSpaceId(session.accountId), session.accountId))
  ) {
    return Response.json({ error: "Invalid upload completion" }, { status: 400 });
  }

  const variants = [
    original,
    ...(optimized ? [optimized] : []),
    ...(thumbnail ? [thumbnail] : []),
  ];
  try {
    const spaceId = personalSpaceId(session.accountId);
    await resolveSpaceAccess({
      accountId: session.accountId,
      spaceId,
      productId: "photos",
    });
    const storage = await getPhotosStorageContext(session.accountId);
    if (
      storage.bucket._id.toString() !== body.bucketId ||
      variants.some(
        (variant) => !isAccountObjectKey(variant.key, session.accountId),
      ) ||
      new Set(variants.map((variant) => variant.key)).size !== variants.length
    ) {
      return Response.json(
        { error: "Invalid regional bucket or object key" },
        { status: 403 },
      );
    }

    const manifest = await PhotoUpload.findOne({
      uploadId: body.uploadId,
      assetId: body.assetId,
      accountId: session.accountId,
      spaceId,
      bucketId: storage.bucket._id,
    });
    if (
      !manifest ||
      manifest.mediaType !== body.mediaType ||
      manifest.original.key !== original.key ||
      manifest.original.size !== original.size ||
      Boolean(manifest.optimized) !== Boolean(optimized) ||
      (optimized && (manifest.optimized?.key !== optimized.key ||
        manifest.optimized.size !== optimized.size)) ||
      Boolean(manifest.thumbnail) !== Boolean(thumbnail) ||
      (thumbnail && (manifest.thumbnail?.key !== thumbnail.key ||
        manifest.thumbnail.size !== thumbnail.size))
    ) {
      return Response.json({ error: "Photo upload manifest mismatch" }, { status: 403 });
    }
    if (manifest.status === "completed") {
      const existingAsset = await PhotoAsset.findOne({
        assetId: manifest.assetId, spaceId, createdByAccountId: session.accountId,
        storageObjectId: manifest._id.toString(),
      }).lean();
      if (!existingAsset) {
        return Response.json({ error: "Completed upload metadata is missing" }, { status: 409 });
      }
      return Response.json({ asset: existingAsset });
    }

    const heads = await Promise.all(
      variants.map((variant) => storage.client.send(new HeadObjectCommand({
        Bucket: storage.bucket.b2BucketId, Key: variant.key,
      }))),
    );
    if (heads.some((head, index) => head.ContentLength !== variants[index]?.size)) {
      return Response.json({ error: "Uploaded object size mismatch" }, { status: 400 });
    }
    const result = await commitPhotoUpload({
      uploadId: manifest.uploadId,
      accountId: session.accountId,
      spaceId,
      bucketId: storage.bucket._id,
      storageObject: {
        key: original.key,
        size: original.size,
        contentType: "application/octet-stream",
        originalContentType: original.contentType,
        mediaCategory: body.mediaType,
        b2FileId: heads[0]?.VersionId ?? `${storage.bucket.b2BucketId}/${original.key}`,
        tags: [], position: 0, uploadSource: "web", isEncrypted: true,
        encryptedDEK: original.encryptedDEK,
        wrappedBy: "space", spaceKeyVersion: 1,
        spaceKeyWrapIv: original.spaceKeyWrapIv, iv: original.iv,
        optimizedKey: optimized?.key, optimizedSize: optimized?.size,
        optimizedContentType: optimized?.contentType,
        optimizedEncryptedDEK: optimized?.encryptedDEK,
        optimizedIV: optimized?.iv,
        optimizedSpaceKeyWrapIv: optimized?.spaceKeyWrapIv,
        thumbnail: thumbnail?.key, thumbnailSize: thumbnail?.size,
        thumbnailContentType: thumbnail?.contentType,
        thumbnailEncryptedDEK: thumbnail?.encryptedDEK,
        thumbnailIV: thumbnail?.iv,
        thumbnailSpaceKeyWrapIv: thumbnail?.spaceKeyWrapIv,
        takenAt,
        aspectRatio: typeof body.width === "number" && typeof body.height === "number" &&
          body.width > 0 && body.height > 0 ? body.width / body.height : undefined,
        revision: 1,
        ...layout,
      },
      asset: {
        mediaType: body.mediaType as "image" | "video",
        takenAt,
        width: typeof body.width === "number" && body.width > 0 ? Math.round(body.width) : undefined,
        height: typeof body.height === "number" && body.height > 0 ? Math.round(body.height) : undefined,
        encryptedMetadata: body.encryptedMetadata as string | undefined,
      },
    });
    return Response.json({ asset: result.asset }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof PhotoUploadCommitError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: "Could not complete upload" }, { status: 500 });
  }
}

/**
 * A video original sealed in chunks (`xenode-file/1`, see
 * lib/photo-encryption): its chunk size, count and IVs, which must account for
 * exactly the stored ciphertext. Null for a single sealed blob.
 */
function chunkLayout(body: CompleteBody, size: number) {
  if (body.chunkSize === undefined && body.chunkIvs === undefined) return null;
  const ivs = body.chunkIvs;
  if (
    body.mediaType !== "video" ||
    body.chunkSize !== FILE_CHUNK_BYTES ||
    !Array.isArray(ivs) ||
    ivs.length !== Math.ceil(size / (FILE_CHUNK_BYTES + 16)) ||
    ivs.some((iv) => typeof iv !== "string" || !/^[A-Za-z0-9+/]{16}$/u.test(iv)) ||
    body.iv !== ivs[0]
  ) {
    return "invalid";
  }
  try {
    fileChunkRange(size, ivs.length - 1, ivs.length, FILE_CHUNK_BYTES);
  } catch {
    return "invalid";
  }
  return { chunkSize: FILE_CHUNK_BYTES, chunkCount: ivs.length, chunkIvs: JSON.stringify(ivs) };
}

function parseVariant(
  body: CompleteBody,
  prefix: "" | "optimized" | "thumbnail",
  maxSize: number,
): EncryptedVariant | null {
  const values = body as Record<string, unknown>;
  const keyName = prefix ? `${prefix}Key` : "objectKey";
  const sizeName = prefix ? `${prefix}Size` : "size";
  const contentTypeName = prefix
    ? `${prefix}ContentType`
    : "originalContentType";
  const dekName = prefix ? `${prefix}EncryptedDEK` : "encryptedDEK";
  const ivName = prefix ? `${prefix}IV` : "iv";
  const wrapIvName = prefix
    ? `${prefix}SpaceKeyWrapIv`
    : "spaceKeyWrapIv";
  const key = values[keyName];
  const size = Number(values[sizeName]);
  const contentType = values[contentTypeName];
  const encryptedDEK = values[dekName];
  const iv = values[ivName];
  const spaceKeyWrapIv = values[wrapIvName];
  if (
    typeof key !== "string" ||
    typeof contentType !== "string" ||
    !contentType ||
    typeof encryptedDEK !== "string" ||
    !encryptedDEK ||
    typeof iv !== "string" ||
    !iv ||
    typeof spaceKeyWrapIv !== "string" ||
    !spaceKeyWrapIv ||
    !Number.isSafeInteger(size) ||
    size <= 16 ||
    size > maxSize
  ) {
    return null;
  }
  return { key, size, contentType, encryptedDEK, iv, spaceKeyWrapIv };
}

function isAccountObjectKey(key: string, accountId: string): boolean {
  return new RegExp(
    `^users/${escapeRegex(accountId)}/[a-f0-9]{32}$`,
    "u",
  ).test(key);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
