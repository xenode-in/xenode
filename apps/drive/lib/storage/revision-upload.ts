import { NextRequest, NextResponse } from "next/server";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  commitDriveRevision, getDriveRevision, reserveDriveRevision, DriveUploadCommitError,
  type DriveRevisionIdentity,
} from "@xenode/database";
import { resolveRegionBucketConfig, type StorageRegion } from "@xenode/config/storage";
import { getS3Client } from "@/lib/b2/client";
import StorageObject from "@/models/StorageObject";
import { publishSyncEvent, toSyncObjectSnapshot } from "@/lib/realtime/publish";
import { folderListingId } from "@/lib/storage/folders";

/** Control metadata only; ciphertext never passes through this handler. */
export async function handleRevisionUpload(request: NextRequest, input: DriveRevisionIdentity & {
  bucketName: string; region: StorageRegion;
}) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Revision requests require JSON", code: "json_revision_required" }, { status: 415 });
  }
  if (resolveRegionBucketConfig(input.region).bucketName !== input.bucketName) {
    throw new DriveUploadCommitError(409, "bucket_routing_changed", "Storage routing is unavailable");
  }
  const body = await request.json();
  if (body?.operation === "presign") {
    const manifest = await reserveDriveRevision({ ...input, size: body.size, iv: body.iv });
    const uploadUrl = await getSignedUrl(getS3Client(input.region), new PutObjectCommand({
      Bucket: input.bucketName, Key: manifest.fileId, ContentType: "application/octet-stream",
      IfNoneMatch: "*",
    }), { expiresIn: 3600 });
    return NextResponse.json({ uploadUrl, sessionId: String(manifest._id) });
  }
  if (body?.operation !== "complete" || typeof body.sessionId !== "string" || !/^[0-9a-f]{24}$/iu.test(body.sessionId)) {
    return NextResponse.json({ error: "Invalid revision operation", code: "invalid_revision_request" }, { status: 400 });
  }
  const manifest = await getDriveRevision({ ...input, sessionId: body.sessionId });
  if (!manifest) throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Revision reservation is missing");
  if (manifest.status === "completed") {
    const result = await commitDriveRevision({
      ...input, sessionId: body.sessionId, verifiedSize: manifest.revisionSize!, b2FileId: "",
    });
    return NextResponse.json({ success: true, revision: result.revision });
  }
  if (manifest.status !== "pending" || manifest.expiresAt <= new Date()) {
    throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Revision is no longer pending");
  }
  let head;
  try {
    head = await getS3Client(input.region).send(new HeadObjectCommand({ Bucket: input.bucketName, Key: manifest.fileId }));
  } catch {
    throw new DriveUploadCommitError(404, "revision_blob_missing", "Revision ciphertext is unavailable");
  }
  if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength !== manifest.revisionSize) {
    throw new DriveUploadCommitError(409, "upload_size_mismatch", "Stored ciphertext size does not match");
  }
  const result = await commitDriveRevision({
    ...input, sessionId: body.sessionId, verifiedSize: head.ContentLength!,
    b2FileId: head.VersionId || `${input.bucketName}/${manifest.fileId}`,
  });
  if (result.created) {
    const object = await StorageObject.findOne({ _id: input.objectId, spaceId: input.spaceId, productId: "drive" })
      .catch((error) => { console.error("Revision notification lookup failed:", error); return null; });
    if (object) await publishSyncEvent({
      userId: input.accountId, spaceId: input.spaceId, type: "FILE_UPDATED",
      payload: {
        objectId: String(object._id), bucketId: String(object.bucketId),
        folderIds: [folderListingId(object.folderId)], object: toSyncObjectSnapshot(object),
      },
      invalidateFolders: [object.folderId ?? null], invalidateStorage: true, invalidateRecent: true,
    }).catch((error) => console.error("Revision notification failed:", error));
  }
  return NextResponse.json({ success: true, revision: result.revision });
}

export function revisionError(error: unknown) {
  if (error instanceof DriveUploadCommitError) {
    return NextResponse.json({ error: error.message, code: error.code, revision: error.revision }, { status: error.status });
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  console.error("Revision upload failed:", error);
  return NextResponse.json({ error: "Revision upload failed" }, { status: 500 });
}
