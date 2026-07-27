import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import {
  adjustStorageBytes,
  incrementStorage,
  updateBucketStats,
} from "@/lib/metering/usage";
import { getS3Client } from "@/lib/b2/client";
import { activeStorageBucketName } from "@/lib/storage/region-context";
import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  parentPrefixForKey,
  publishSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";
import {
  adjustOrgStorage,
  incrementOrgStorage,
} from "@/lib/orgs/billing/orgUsage";
import {
  orgObjectKeyPrefix,
  teamObjectKeyPrefix,
} from "@/lib/orgs/storage";
import { completeUploadSession } from "@/lib/uploads/session";

export const dynamic = "force-dynamic";

function belongsToPrefix(key: unknown, prefix: string): key is string {
  return typeof key === "string" && key.startsWith(prefix);
}

async function deleteUploadedKeys(
  b2BucketId: string,
  keys: unknown[],
): Promise<void> {
  const unique = Array.from(
    new Set(keys.filter((key): key is string => typeof key === "string" && !!key)),
  );
  await Promise.all(
    unique.map((Key) =>
      getS3Client()
        .send(new DeleteObjectCommand({ Bucket: b2BucketId, Key }))
        .catch((err) =>
          console.warn(`Failed to delete uploaded B2 object ${Key}:`, err),
        ),
    ),
  );
}

type MediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "archive"
  | "code"
  | "other";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function getMediaCategory(mimeType: string): MediaCategory {
  if (!mimeType) return "other";
  mimeType = mimeType.toLowerCase();
  
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  
  if (mimeType.includes("pdf")) return "pdf";
  
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("xls") || mimeType.includes("csv")) return "excel";
  if (mimeType.includes("wordprocessing") || mimeType.includes("word") || mimeType.includes("doc")) return "word";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint") || mimeType.includes("ppt")) return "powerpoint";
  
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("rar") || mimeType.includes("7z") || mimeType.includes("archive")) return "archive";
  
  if (mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("html") || mimeType.includes("xml") || mimeType.includes("text/css") || mimeType.includes("text/x-") || mimeType.includes("application/x-sh")) return "code";

  if (mimeType.includes("document") || mimeType.includes("text/")) return "document";
  
  return "other";
}

async function emitObjectChange(
  userId: string,
  object: InstanceType<typeof StorageObject>,
  type: "FILE_CREATED" | "FILE_UPDATED",
): Promise<void> {
  const key = object.key;
  await publishSyncEvent({
    userId,
    spaceId: object.spaceId,
    type,
    payload: {
      bucketId: object.bucketId.toString(),
      objectId: object._id.toString(),
      key,
      parentPrefix: parentPrefixForKey(key),
      object: toSyncObjectSnapshot(object),
    },
    invalidatePrefixes: [parentPrefixForKey(key)],
    invalidateStorage: true,
    invalidateRecent: true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;

    const {
      objectKey,
      bucketId,
      size,
      contentType,
      originalContentType,
      encryptedContentType,
      thumbnail,
      encryptedDEK,
      iv,
      isEncrypted,
      encryptedName,
      chunkSize,
      chunkCount,
      chunkIvs,
      isChunked,
      chunks,
      encryptedMetadata,
      optimizedKey,
      optimizedSize,
      optimizedContentType,
      optimizedIV,
      optimizedEncryptedDEK,
      optimizedSpaceKeyWrapIv,
      aspectRatio,
      wrappedBy,
      spaceKeyVersion,
      spaceKeyWrapIv,
      isSidecar,
      parentObjectId,
      syncContentFp,
      syncMetaFp,
      uploadSource,
    } = await request.json();

    if (!objectKey || !bucketId || !size) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const allowedPrefix =
      ctx.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
        : `users/${userId}/`;

    if (!belongsToPrefix(objectKey, allowedPrefix)) {
      return NextResponse.json(
        { error: "Invalid object key" },
        { status: 403 },
      );
    }
    const relatedKeys = [
      optimizedKey,
      thumbnail,
      ...(Array.isArray(chunks) ? chunks.map((chunk) => chunk?.key) : []),
    ].filter(Boolean);
    if (relatedKeys.some((key) => !belongsToPrefix(key, allowedPrefix))) {
      return NextResponse.json(
        { error: "Invalid related object key" },
        { status: 403 },
      );
    }

    if (ctx.spaceType !== "personal") {
      const version = Number(spaceKeyVersion);
      if (
        isEncrypted !== true ||
        wrappedBy !== "space" ||
        typeof encryptedDEK !== "string" ||
        !encryptedDEK.trim() ||
        typeof spaceKeyWrapIv !== "string" ||
        !spaceKeyWrapIv.trim() ||
        !Number.isInteger(version) ||
        version < 1
      ) {
        return NextResponse.json(
          {
            error:
              "Organization and team uploads must be encrypted and wrapped by the workspace space key",
            code: "workspace_space_wrapped_encryption_required",
          },
          { status: 400 },
        );
      }
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const mediaCategory = getMediaCategory(originalContentType ?? contentType);
    const normalizedUploadSource =
      uploadSource === "mobile_backup" ||
      uploadSource === "mobile_manual" ||
      uploadSource === "migration" ||
      uploadSource === "web"
        ? uploadSource
        : syncContentFp || syncMetaFp
          ? "mobile_backup"
          : "web";

    let b2FileId = "";
    if (isChunked) {
      if (!chunks || chunks.length !== chunkCount) {
        return NextResponse.json(
          { error: "Invalid chunks provided" },
          { status: 400 },
        );
      }

      let totalSize = 0;
      for (const chunk of chunks) {
        try {
          const command = new HeadObjectCommand({
            Bucket: activeStorageBucketName(),
            Key: chunk.key,
          });
          await getS3Client().send(command);
          totalSize += chunk.size;
        } catch (err) {
          console.error(`Failed to head chunk ${chunk.key} from B2:`, err);
          return NextResponse.json(
            { error: `Chunk ${chunk.index} not found in storage` },
            { status: 404 },
          );
        }
      }

      if (totalSize !== size) {
        return NextResponse.json({ error: "Size mismatch" }, { status: 400 });
      }

      // No single b2FileId for chunked uploads
      b2FileId = `multipart-${objectKey}`;
    } else {
      try {
        const command = new HeadObjectCommand({
          Bucket: activeStorageBucketName(),
          Key: objectKey,
        });
        const s3Response = await getS3Client().send(command);
        b2FileId = s3Response.VersionId || `${activeStorageBucketName()}/${objectKey}`;
      } catch (err) {
        console.error("Failed to head object from B2:", err);
        return NextResponse.json(
          { error: "File not found in storage" },
          { status: 404 },
        );
      }
    }

    const existingObject = await StorageObject.findOne({
      bucketId,
      key: objectKey,
    });

    if (existingObject) {
      const sizeDiff = size - existingObject.size;
      if (sizeDiff !== 0) {
        if (ctx.spaceType !== "personal") {
          await adjustOrgStorage(ctx.organizationId!, sizeDiff);
        } else {
          await adjustStorageBytes(userId, sizeDiff);
        }
      }
      existingObject.size = size;
      existingObject.contentType = contentType;
      existingObject.mediaCategory = mediaCategory;
      existingObject.b2FileId = b2FileId;
      if (thumbnail) existingObject.thumbnail = thumbnail;
      if (isEncrypted) {
        existingObject.isEncrypted = true;
        if (encryptedContentType)
          existingObject.encryptedContentType = encryptedContentType;
        if (encryptedDEK) existingObject.encryptedDEK = encryptedDEK;
        if (wrappedBy) existingObject.wrappedBy = wrappedBy;
        if (spaceKeyVersion)
          existingObject.spaceKeyVersion = Number(spaceKeyVersion);
        if (spaceKeyWrapIv) existingObject.spaceKeyWrapIv = spaceKeyWrapIv;
        if (iv) existingObject.iv = iv;
        if (encryptedName) existingObject.encryptedName = encryptedName;
        if (chunkSize) existingObject.chunkSize = chunkSize;
        if (chunkCount) existingObject.chunkCount = chunkCount;
        if (chunkIvs) existingObject.chunkIvs = chunkIvs;
        if (isChunked && chunks) existingObject.chunks = chunks;
        if (encryptedMetadata) existingObject.encryptedMetadata = encryptedMetadata;
        if (optimizedKey) existingObject.optimizedKey = optimizedKey;
        if (optimizedSize) existingObject.optimizedSize = optimizedSize;
        if (optimizedContentType) existingObject.optimizedContentType = optimizedContentType;
        if (optimizedIV) existingObject.optimizedIV = optimizedIV;
        if (optimizedEncryptedDEK) existingObject.optimizedEncryptedDEK = optimizedEncryptedDEK;
        if (optimizedSpaceKeyWrapIv) existingObject.optimizedSpaceKeyWrapIv = optimizedSpaceKeyWrapIv;
        if (aspectRatio) existingObject.aspectRatio = aspectRatio;
      }
      if (isSidecar !== undefined) existingObject.isSidecar = isSidecar;
      if (parentObjectId) existingObject.parentObjectId = parentObjectId;
      if (syncContentFp) existingObject.syncContentFp = syncContentFp;
      if (syncMetaFp) existingObject.syncMetaFp = syncMetaFp;
      existingObject.uploadSource = normalizedUploadSource;
      try {
        await existingObject.save();
      } catch (error) {
        if (sizeDiff !== 0) {
          const rollback =
            ctx.spaceType === "organization"
            || ctx.spaceType === "team"
              ? adjustOrgStorage(ctx.organizationId!, -sizeDiff)
              : adjustStorageBytes(userId, -sizeDiff);
          await rollback.catch((rollbackError) =>
            console.error(
              "Failed to roll back storage byte adjustment:",
              rollbackError,
            ),
          );
        }
        throw error;
      }
      if (sizeDiff !== 0) {
        await updateBucketStats(bucketId, 0, sizeDiff);
      }
      await emitObjectChange(userId, existingObject, "FILE_UPDATED");
      await completeUploadSession(bucketId, objectKey);
      return NextResponse.json({ object: existingObject });
    }

    // Content-fingerprint dedup guard. The mobile client already runs a
    // pre-upload sync-check, but two devices (or a retry racing the original)
    // can both upload the same content before either records it. If an object
    // with this content fingerprint already exists in the bucket, the just-
    // uploaded B2 blob is a duplicate: delete it (best-effort, so we don't
    // double-charge storage) and return the existing object instead of
    // creating a second StorageObject.
    if (syncContentFp) {
      const dupe = await StorageObject.findOne({
        bucketId,
        syncContentFp,
        deletedAt: { $exists: false },
      });
      if (dupe) {
        await deleteUploadedKeys(activeStorageBucketName(), [
          objectKey,
          optimizedKey,
          thumbnail,
        ]);
        return NextResponse.json({ object: dupe });
      }
    }

    if (optimizedKey) {
      try {
        const command = new HeadObjectCommand({
          Bucket: activeStorageBucketName(),
          Key: optimizedKey,
        });
        await getS3Client().send(command);
      } catch {
        console.warn(`Optimized file ${optimizedKey} not found in storage, continuing anyway.`);
      }
    }

    let storageObject;
    try {
      storageObject = await StorageObject.create({
        bucketId,
        spaceId: ctx.spaceId,
        createdByAccountId: ctx.accountId,
        key: objectKey,
        size,
        contentType:
          originalContentType ?? contentType ?? "application/octet-stream",
        encryptedContentType: encryptedContentType ?? undefined,
        mediaCategory,
        b2FileId,
        thumbnail,
        isEncrypted: isEncrypted ?? false,
        encryptedDEK: encryptedDEK ?? undefined,
        wrappedBy: wrappedBy ?? (isEncrypted ? "user" : undefined),
        spaceKeyVersion:
          spaceKeyVersion !== undefined ? Number(spaceKeyVersion) : undefined,
        spaceKeyWrapIv: spaceKeyWrapIv ?? undefined,
        iv: iv ?? undefined,
        encryptedName: encryptedName ?? undefined,
        chunkSize: chunkSize ?? undefined,
        chunkCount: chunkCount ?? undefined,
        chunkIvs: chunkIvs ?? undefined,
        chunks: isChunked && chunks ? chunks : undefined,
        encryptedMetadata: encryptedMetadata ?? undefined,
        optimizedKey: optimizedKey ?? undefined,
        optimizedSize: optimizedSize ?? undefined,
        optimizedContentType: optimizedContentType ?? undefined,
        optimizedIV: optimizedIV ?? undefined,
        optimizedEncryptedDEK: optimizedEncryptedDEK ?? undefined,
        optimizedSpaceKeyWrapIv: optimizedSpaceKeyWrapIv ?? undefined,
        aspectRatio: aspectRatio ?? undefined,
        isSidecar: isSidecar ?? false,
        parentObjectId: parentObjectId ?? undefined,
        syncContentFp: syncContentFp ?? undefined,
        syncMetaFp: syncMetaFp ?? undefined,
        uploadSource: normalizedUploadSource,
        // Seed "recent" with the upload time so a never-opened file still has a
        // sensible position; opening the file later bumps it via GET /[id].
        lastAccessedAt: new Date(),
      });
    } catch (error) {
      if (!syncContentFp || !isDuplicateKeyError(error)) throw error;

      const winner = await StorageObject.findOne({
        bucketId,
        syncContentFp,
        deletedAt: { $exists: false },
      });
      if (!winner) throw error;

      await deleteUploadedKeys(activeStorageBucketName(), [
        objectKey,
        optimizedKey,
        thumbnail,
      ]);
      return NextResponse.json({ object: winner });
    }

    try {
      if (ctx.spaceType !== "personal") {
        await incrementOrgStorage(ctx.organizationId!, size);
      } else {
        await incrementStorage(userId, size, {
          contentType: originalContentType ?? contentType,
          bucketId,
          isEncrypted,
        });
      }
    } catch (error) {
      // The blobs already exist and the metadata row was just created. Roll
      // both back when quota rejects finalization so the client can surface a
      // durable quota failure without leaking inaccessible encrypted objects.
      await StorageObject.deleteOne({ _id: storageObject._id }).catch(
        (rollbackError) =>
          console.error(
            `Failed to roll back StorageObject ${storageObject._id}:`,
            rollbackError,
          ),
      );
      await deleteUploadedKeys(activeStorageBucketName(), [
        objectKey,
        optimizedKey,
        thumbnail,
        ...(Array.isArray(chunks) ? chunks.map((chunk) => chunk?.key) : []),
      ]);
      throw error;
    }
    await updateBucketStats(bucketId, 1, size);
    await emitObjectChange(userId, storageObject, "FILE_CREATED");
    await completeUploadSession(bucketId, objectKey);

    return NextResponse.json({ object: storageObject }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "Storage quota exceeded" },
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
