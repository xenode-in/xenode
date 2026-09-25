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
import UploadSession from "@/models/UploadSession";
import {
  incrementStorage,
  updateBucketStats,
} from "@/lib/metering/usage";
import { getS3Client } from "@/lib/b2/client";
import { activeStorageBucketName } from "@/lib/storage/region-context";
import type { StorageRegion } from "@xenode/config/storage";
import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  parentPrefixForKey,
  publishSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";
import {
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
  region: StorageRegion,
): Promise<void> {
  const unique = Array.from(
    new Set(keys.filter((key): key is string => typeof key === "string" && !!key)),
  );
  await Promise.all(
    unique.map((Key) =>
      getS3Client(region)
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
  type: "FILE_CREATED",
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
    const ctx = await requireAccessContext(request, "write");
    const userId = ctx.userId;

    const {
      objectKey,
      bucketId,
      sessionId,
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

    if (!objectKey || !bucketId || !size || typeof sessionId !== "string" ||
      !/^[0-9a-f]{24}$/iu.test(sessionId)) {
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
    if (
      isEncrypted !== true ||
      typeof encryptedDEK !== "string" || !encryptedDEK.trim() ||
      typeof encryptedName !== "string" || !encryptedName.trim()
    ) {
      return NextResponse.json(
        { error: "Encrypted file metadata is required", code: "encrypted_upload_required" },
        { status: 400 },
      );
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const reservation = await UploadSession.findOne({
      _id: sessionId,
      userId,
      spaceId: ctx.spaceId,
      bucketId: bucket._id,
      fileId: objectKey,
      status: "pending",
      expiresAt: { $gt: new Date() },
    }).select("keys").lean();
    if (!reservation) {
      return NextResponse.json(
        { error: "Upload reservation is missing or no longer pending", code: "upload_reservation_conflict" },
        { status: 409 },
      );
    }
    const claimedKeys = new Set(reservation.keys);
    const physicalKeys = [
      objectKey,
      optimizedKey,
      typeof thumbnail === "string" && thumbnail.startsWith(allowedPrefix)
        ? thumbnail : null,
      ...(Array.isArray(chunks) ? chunks.map((chunk) => chunk?.key) : []),
    ].filter((key): key is string => typeof key === "string" && !!key);
    if (physicalKeys.some((key) => !claimedKeys.has(key))) {
      return NextResponse.json(
        { error: "Blob key does not belong to this upload", code: "unclaimed_upload_key" },
        { status: 403 },
      );
    }
    if (await StorageObject.exists({ bucketId: bucket._id, key: objectKey })) {
      return NextResponse.json(
        { error: "Object key already completed", code: "object_key_conflict" },
        { status: 409 },
      );
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
            Bucket: activeStorageBucketName(ctx.region),
            Key: chunk.key,
          });
          await getS3Client(ctx.region).send(command);
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
          Bucket: activeStorageBucketName(ctx.region),
          Key: objectKey,
        });
        const s3Response = await getS3Client(ctx.region).send(command);
        b2FileId = s3Response.VersionId || `${activeStorageBucketName(ctx.region)}/${objectKey}`;
      } catch (err) {
        console.error("Failed to head object from B2:", err);
        return NextResponse.json(
          { error: "File not found in storage" },
          { status: 404 },
        );
      }
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
        spaceId: ctx.spaceId,
        productId: "drive",
        syncContentFp,
        deletedAt: { $exists: false },
      });
      if (dupe) {
        await deleteUploadedKeys(activeStorageBucketName(ctx.region), [
          objectKey,
          optimizedKey,
          thumbnail,
        ], ctx.region);
        return NextResponse.json({ object: dupe });
      }
    }

    if (optimizedKey) {
      try {
        const command = new HeadObjectCommand({
          Bucket: activeStorageBucketName(ctx.region),
          Key: optimizedKey,
        });
        await getS3Client(ctx.region).send(command);
      } catch {
        console.warn(`Optimized file ${optimizedKey} not found in storage, continuing anyway.`);
      }
    }

    let storageObject;
    try {
      storageObject = await StorageObject.create({
        bucketId,
        productId: "drive",
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
        isEncrypted: true,
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
      if (
        isDuplicateKeyError(error) &&
        await StorageObject.exists({ bucketId: bucket._id, key: objectKey })
      ) {
        return NextResponse.json(
          { error: "Object key already completed", code: "object_key_conflict" },
          { status: 409 },
        );
      }
      if (!syncContentFp || !isDuplicateKeyError(error)) throw error;

      const winner = await StorageObject.findOne({
        bucketId,
        spaceId: ctx.spaceId,
        productId: "drive",
        syncContentFp,
        deletedAt: { $exists: false },
      });
      if (!winner) throw error;

      await deleteUploadedKeys(activeStorageBucketName(ctx.region), [
        objectKey,
        optimizedKey,
        thumbnail,
      ], ctx.region);
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
      await deleteUploadedKeys(
        activeStorageBucketName(ctx.region),
        [
          objectKey,
          optimizedKey,
          thumbnail,
          ...(Array.isArray(chunks) ? chunks.map((chunk) => chunk?.key) : []),
        ],
        ctx.region,
      );
      throw error;
    }
    await updateBucketStats(bucketId, 1, size);
    const markedCompleted = await completeUploadSession({
      sessionId, userId, spaceId: ctx.spaceId, bucketId: bucket._id,
      fileId: objectKey,
    });
    if (!markedCompleted) {
      throw new Error("Upload reservation could not be completed");
    }
    await emitObjectChange(userId, storageObject, "FILE_CREATED");

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
