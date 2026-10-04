import { NextRequest, NextResponse } from "next/server";
import { bucketOwnershipClause, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import { commitDriveUpload, DriveUploadCommitError, type VerifiedDriveBlob } from "@xenode/database";
import { getS3Client } from "@/lib/b2/client";
import { activeStorageBucketName } from "@/lib/storage/region-context";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { publishSyncEvent, toSyncObjectSnapshot } from "@/lib/realtime/publish";
import { folderListingId, spaceStorageRoot } from "@/lib/storage/folders";

export const dynamic = "force-dynamic";
const MAX_CHUNKS = 4096;
type Chunk = VerifiedDriveBlob & { index: number };

function belongsToPrefix(key: unknown, prefix: string): key is string {
  return typeof key === "string" && key.startsWith(prefix);
}

function validChunkLayout(chunks: unknown, count: unknown, key: string, size: number): chunks is Chunk[] {
  if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > MAX_CHUNKS ||
    !Array.isArray(chunks) || chunks.length !== count) return false;
  let total = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (!chunk || chunk.index !== index || chunk.key !== `${key}-chunk-${index}` ||
      !Number.isSafeInteger(chunk.size) || chunk.size < 1 ||
      (index < chunks.length - 1 && chunk.size !== chunks[0].size) ||
      chunk.size > chunks[0].size) return false;
    total += chunk.size;
  }
  return Number.isSafeInteger(total) && total === size;
}

function getMediaCategory(mimeType: string) {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf")) return "pdf";
  if (/spreadsheet|excel|xls|csv/u.test(mime)) return "excel";
  if (/wordprocessing|word|doc/u.test(mime)) return "word";
  if (/presentation|powerpoint|ppt/u.test(mime)) return "powerpoint";
  if (/zip|tar|rar|7z|archive/u.test(mime)) return "archive";
  if (/json|javascript|html|xml|text\/css|text\/x-|application\/x-sh/u.test(mime)) return "code";
  if (/document|text\//u.test(mime)) return "document";
  return "other";
}

async function emitObjectChange(userId: string, object: InstanceType<typeof StorageObject>) {
  await publishSyncEvent({
    userId, spaceId: object.spaceId, type: "FILE_CREATED",
    payload: {
      bucketId: object.bucketId.toString(), objectId: object._id.toString(),
      folderIds: [folderListingId(object.folderId)],
      object: toSyncObjectSnapshot(object),
    },
    invalidateFolders: [object.folderId ?? null],
    invalidateStorage: true, invalidateRecent: true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "write");
    const {
      objectKey, bucketId, sessionId, size, contentType, originalContentType,
      encryptedContentType, thumbnail, thumbnailSize, encryptedDEK, iv,
      isEncrypted, encryptedName, chunkSize, chunkCount, chunkIvs, isChunked,
      chunks, encryptedMetadata, optimizedKey, optimizedSize, optimizedContentType,
      optimizedIV, optimizedEncryptedDEK, optimizedSpaceKeyWrapIv, aspectRatio,
      wrappedBy, spaceKeyVersion, spaceKeyWrapIv, isSidecar, parentObjectId,
      syncContentFp, syncMetaFp, uploadSource, folderId,
    } = await request.json();
    if (typeof objectKey !== "string" || typeof bucketId !== "string" ||
      !/^[0-9a-f]{24}$/iu.test(bucketId) || typeof sessionId !== "string" ||
      !/^[0-9a-f]{24}$/iu.test(sessionId) || !Number.isSafeInteger(size) || size < 1 ||
      (contentType !== undefined && typeof contentType !== "string") ||
      (originalContentType !== undefined && typeof originalContentType !== "string") ||
      (isChunked !== undefined && typeof isChunked !== "boolean") ||
      (folderId !== undefined && folderId !== null && typeof folderId !== "string")) {
      return NextResponse.json({ error: "Invalid required upload fields" }, { status: 400 });
    }
    const allowedPrefix = spaceStorageRoot(ctx);
    if (!belongsToPrefix(objectKey, allowedPrefix)) {
      return NextResponse.json({ error: "Invalid object key" }, { status: 403 });
    }
    const relatedKeys = [optimizedKey, thumbnail, ...(Array.isArray(chunks) ? chunks.map((chunk) => chunk?.key) : [])]
      .filter((key) => key !== undefined && key !== null);
    if (relatedKeys.some((key) => !belongsToPrefix(key, allowedPrefix))) {
      return NextResponse.json({ error: "Invalid related object key" }, { status: 403 });
    }
    if (ctx.spaceType !== "personal" && (isEncrypted !== true || wrappedBy !== "space" ||
      typeof encryptedDEK !== "string" || !encryptedDEK.trim() ||
      typeof spaceKeyWrapIv !== "string" || !spaceKeyWrapIv.trim() ||
      !Number.isSafeInteger(spaceKeyVersion) || spaceKeyVersion < 1)) {
      return NextResponse.json({
        error: "Organization and team uploads must be encrypted and wrapped by the workspace space key",
        code: "workspace_space_wrapped_encryption_required",
      }, { status: 400 });
    }
    if (isEncrypted !== true || typeof encryptedDEK !== "string" || !encryptedDEK.trim() ||
      typeof encryptedName !== "string" || !encryptedName.trim()) {
      return NextResponse.json({ error: "Encrypted file metadata is required", code: "encrypted_upload_required" }, { status: 400 });
    }
    if ((isChunked && !validChunkLayout(chunks, chunkCount, objectKey, size)) ||
      (!isChunked && chunks !== undefined) ||
      (optimizedSize !== undefined && (!optimizedKey || !Number.isSafeInteger(optimizedSize) || optimizedSize < 1)) ||
      (thumbnailSize !== undefined && (!thumbnail || !Number.isSafeInteger(thumbnailSize) || thumbnailSize < 1))) {
      return NextResponse.json({ error: "Invalid blob layout or size", code: "invalid_upload_layout" }, { status: 400 });
    }
    if (isChunked) {
      let ivs: unknown;
      try { ivs = typeof chunkIvs === "string" ? JSON.parse(chunkIvs) : null; } catch { ivs = null; }
      if (!Array.isArray(ivs) || ivs.length !== chunkCount || ivs.some((value) => typeof value !== "string" || !value)) {
        return NextResponse.json({ error: "Invalid chunk IV layout", code: "invalid_upload_layout" }, { status: 400 });
      }
    }
    await dbConnect();
    const bucket = await Bucket.findOne({ _id: bucketId, ...bucketOwnershipClause(ctx) });
    if (!bucket) return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    const reservation = await UploadSession.findOne({
      _id: sessionId, userId: ctx.accountId, spaceId: ctx.spaceId,
      bucketId: bucket._id, fileId: objectKey,
      purpose: "create",
    }).lean();
    if (!reservation) {
      return NextResponse.json({ error: "Upload reservation is missing", code: "upload_reservation_conflict" }, { status: 409 });
    }
    if (reservation.status === "completed") {
      const completed = await StorageObject.findOne({
        _id: reservation._id, bucketId: bucket._id, key: objectKey, productId: "drive",
        spaceId: ctx.spaceId, createdByAccountId: ctx.accountId, deletedAt: null,
      });
      if (completed) return NextResponse.json({ object: completed });
    }
    if (reservation.status !== "pending" || reservation.expiresAt <= new Date()) {
      return NextResponse.json({ error: "Upload is no longer pending", code: "upload_reservation_conflict" }, { status: 409 });
    }
    const mainBlobs: VerifiedDriveBlob[] = isChunked ? chunks : [{ key: objectKey, size }];
    const expectedBlobs: Array<{ key: string; size?: number }> = [
      ...mainBlobs,
      ...(optimizedKey ? [{ key: optimizedKey, size: optimizedSize }] : []),
      ...(thumbnail ? [{ key: thumbnail, size: thumbnailSize }] : []),
    ];
    // The logical key is claimed even when only chunk blobs exist physically.
    const claimedKeys = new Set(reservation.keys);
    if (!claimedKeys.has(objectKey) || expectedBlobs.some((blob) => !claimedKeys.has(blob.key))) {
      return NextResponse.json({ error: "Blob key does not belong to this upload", code: "unclaimed_upload_key" }, { status: 403 });
    }
    if (isChunked && reservation.keys.filter((key) => key.startsWith(`${objectKey}-chunk-`)).length !== chunkCount) {
      return NextResponse.json({ error: "Reserved chunk layout changed", code: "invalid_upload_layout" }, { status: 400 });
    }
    if (await StorageObject.exists({ bucketId: bucket._id, key: objectKey })) {
      return NextResponse.json({ error: "Object key already completed", code: "object_key_conflict" }, { status: 409 });
    }
    const verifiedBlobs: VerifiedDriveBlob[] = [];
    let b2FileId = isChunked ? `multipart-${objectKey}` : "";
    for (const blob of expectedBlobs) {
      let head;
      try {
        head = await getS3Client(ctx.region).send(new HeadObjectCommand({
          Bucket: activeStorageBucketName(ctx.region), Key: blob.key,
        }));
      } catch {
        return NextResponse.json({ error: "Upload blob is unavailable in storage", code: "upload_blob_missing" }, { status: 404 });
      }
      const actualSize = head.ContentLength;
      if (!Number.isSafeInteger(actualSize) || actualSize! < 1 ||
        (blob.size !== undefined && blob.size !== actualSize)) {
        return NextResponse.json({ error: "Stored ciphertext size does not match", code: "upload_size_mismatch" }, { status: 409 });
      }
      verifiedBlobs.push({ key: blob.key, size: actualSize! });
      if (!isChunked && blob.key === objectKey) {
        b2FileId = head.VersionId || `${activeStorageBucketName(ctx.region)}/${objectKey}`;
      }
    }
    const normalizedUploadSource = ["mobile_backup", "mobile_manual", "migration", "web"].includes(uploadSource)
      ? uploadSource : syncContentFp || syncMetaFp ? "mobile_backup" : "web";
    const storageObject = new StorageObject({
      _id: reservation._id, bucketId: bucket._id, productId: "drive", spaceId: ctx.spaceId,
      createdByAccountId: ctx.accountId, key: objectKey, size,
      contentType: originalContentType ?? contentType ?? "application/octet-stream",
      encryptedContentType, mediaCategory: getMediaCategory(originalContentType ?? contentType ?? ""),
      b2FileId, thumbnail,
      thumbnailSize: thumbnail ? verifiedBlobs.find((blob) => blob.key === thumbnail)!.size : undefined,
      isEncrypted: true, encryptedDEK, wrappedBy: wrappedBy ?? "user", spaceKeyVersion,
      spaceKeyWrapIv, iv, encryptedName, chunkSize, chunkCount, chunkIvs,
      chunks: isChunked ? chunks : undefined, encryptedMetadata,
      optimizedKey,
      optimizedSize: optimizedKey ? verifiedBlobs.find((blob) => blob.key === optimizedKey)!.size : undefined,
      optimizedContentType, optimizedIV, optimizedEncryptedDEK, optimizedSpaceKeyWrapIv,
      aspectRatio, isSidecar: isSidecar ?? false, parentObjectId, syncContentFp, syncMetaFp,
      uploadSource: normalizedUploadSource, lastAccessedAt: new Date(),
    });
    await storageObject.validate();
    // Ensure the object-key and active fingerprint unique indexes before raw transactional insert.
    await StorageObject.init();
    const result = await commitDriveUpload({
      sessionId, accountId: ctx.accountId, spaceId: ctx.spaceId, bucketId: bucket._id,
      storageObject: { ...storageObject.toObject() }, verifiedBlobs, folderId: folderId ?? null,
    });
    const committed = StorageObject.hydrate(result.object);
    if (result.created) {
      await emitObjectChange(ctx.userId, committed).catch((error) => console.error("Upload realtime notification failed:", error));
    }
    return NextResponse.json({ object: committed }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    if (error instanceof DriveUploadCommitError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SyntaxError || (error instanceof Error && ["ValidationError", "CastError"].includes(error.name))) {
      return NextResponse.json({ error: "Invalid upload metadata" }, { status: 400 });
    }
    console.error("Upload finalization failed:", error);
    return NextResponse.json({ error: "Upload finalization failed" }, { status: 500 });
  }
}
