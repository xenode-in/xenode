import { randomBytes } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
import { connectDatabase, getDatabase, withTransaction } from "../connection";
import { DriveUploadSession, Space } from "../models";
import { DriveUploadCommitError, loadSpaceUsage } from "./drive-uploads";

export const MAX_DRIVE_REVISION_BYTES = 128 * 1024 * 1024 + 16;
export const MAX_RETAINED_VERSIONS = 10;

export interface DriveRevisionIdentity {
  accountId: string;
  spaceId: string;
  bucketId: Types.ObjectId;
  objectId: Types.ObjectId;
  baseRevision: number;
  shareId?: Types.ObjectId;
}

function objectFilter(input: DriveRevisionIdentity) {
  return { _id: input.objectId, spaceId: input.spaceId, bucketId: input.bucketId, productId: "drive", deletedAt: null };
}

async function assertShare(input: DriveRevisionIdentity, session?: ClientSession, touch = false) {
  if (!input.shareId) return;
  const shares = getDatabase().collection("directshares");
  const filter = {
    _id: input.shareId, objectId: input.objectId, bucketId: input.bucketId, isRevoked: false,
    recipients: { $elemMatch: { recipientUserId: input.accountId, accessType: "editor" } },
  };
  // The write makes revocation/role changes conflict with a snapshot commit.
  const share = touch
    ? await shares.findOneAndUpdate(filter, { $set: { updatedAt: new Date(), "recipients.$.lastAccessedAt": new Date() } }, { session, returnDocument: "after" })
    : await shares.findOne(filter, { session });
  if (!share) throw new DriveUploadCommitError(403, "edit_forbidden", "The share no longer permits editing");
}

export async function reserveDriveRevision(input: DriveRevisionIdentity & { size: number; iv: string }) {
  await connectDatabase();
  if (!Number.isSafeInteger(input.size) || input.size < 16 || input.size > MAX_DRIVE_REVISION_BYTES ||
    !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 ||
    !/^[A-Za-z0-9+/]{16}$/u.test(input.iv) || Buffer.from(input.iv, "base64").toString("base64") !== input.iv) {
    throw new DriveUploadCommitError(400, "invalid_revision_metadata", "Invalid revision size or IV");
  }
  await DriveUploadSession.init();
  return withTransaction(async (session) => {
    await assertShare(input, session);
    const object = await getDatabase().collection("storageobjects").findOne(objectFilter(input), { session });
    if (!object) throw new DriveUploadCommitError(404, "object_missing", "File is unavailable");
    if (object.revision !== input.baseRevision) throw new DriveUploadCommitError(409, "revision_conflict", "The file changed", object.revision);
    if (object.versions?.length >= 256) throw new DriveUploadCommitError(409, "version_cleanup_backlog", "Version cleanup must complete before another save");
    if (object.isEncrypted !== true || !object.encryptedDEK || object.chunks?.length) {
      throw new DriveUploadCommitError(400, "single_encrypted_blob_required", "Revisions require a single encrypted blob");
    }
    if (object.iv === input.iv || object.versions?.some((version: { iv?: string }) => version.iv === input.iv)) {
      throw new DriveUploadCommitError(400, "revision_iv_reused", "A revision requires a fresh IV");
    }
    const { usage } = await loadSpaceUsage(input.spaceId, input.shareId ? undefined : input.accountId, session);
    if (!Number.isSafeInteger(usage.totalStorageBytes + input.size) ||
      (usage.storageLimitBytes !== null && usage.totalStorageBytes + input.size > usage.storageLimitBytes)) {
      throw new DriveUploadCommitError(402, "storage_quota_exceeded", "Storage quota exceeded");
    }
    const key = `${String(object.key).slice(0, String(object.key).lastIndexOf("/") + 1)}${randomBytes(16).toString("hex")}`;
    const [manifest] = await DriveUploadSession.create([{
      purpose: "revision", userId: input.accountId, spaceId: input.spaceId, bucketId: input.bucketId,
      fileId: key, keys: [key], targetObjectId: input.objectId, baseRevision: input.baseRevision,
      revisionSize: input.size, revisionIv: input.iv, authorizationShareId: input.shareId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }], { session });
    return manifest.toObject();
  }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new DriveUploadCommitError(409, "revision_iv_claimed", "This revision IV is already reserved");
    }
    throw error;
  });
}

export async function getDriveRevision(input: DriveRevisionIdentity & { sessionId: string }) {
  await connectDatabase();
  return DriveUploadSession.findOne({
    _id: input.sessionId, purpose: "revision", userId: input.accountId, spaceId: input.spaceId,
    bucketId: input.bucketId, targetObjectId: input.objectId, baseRevision: input.baseRevision,
    authorizationShareId: input.shareId ?? null,
  }).lean();
}

export const contentFields = [
  "key", "b2FileId", "size", "contentType", "encryptedDEK", "wrappedBy", "spaceKeyId",
  "spaceKeyVersion", "spaceKeyWrapIv", "iv", "chunkSize", "chunkCount", "chunkIvs", "chunks", "encryptedMetadata",
] as const;

export async function commitDriveRevision(input: DriveRevisionIdentity & {
  sessionId: string; verifiedSize: number; b2FileId: string;
}) {
  return withTransaction(async (session) => {
    await assertShare(input, session, true);
    const manifest = await DriveUploadSession.findOne({
      _id: input.sessionId, purpose: "revision", userId: input.accountId, spaceId: input.spaceId,
      bucketId: input.bucketId, targetObjectId: input.objectId, baseRevision: input.baseRevision,
      authorizationShareId: input.shareId ?? null,
    }).session(session).lean();
    if (!manifest) throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Revision reservation is missing");
    if (!await Space.exists({ _id: input.spaceId, status: "active" }).session(session)) {
      throw new DriveUploadCommitError(409, "space_owner_missing", "Owning Space is unavailable");
    }
    if (manifest.status === "completed" && Number.isSafeInteger(manifest.committedRevision)) {
      return { revision: manifest.committedRevision!, created: false };
    }
    if (manifest.status !== "pending" || manifest.expiresAt <= new Date() ||
      manifest.revisionSize !== input.verifiedSize || manifest.keys.length !== 1 || manifest.keys[0] !== manifest.fileId) {
      throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Revision reservation is no longer valid");
    }
    const database = getDatabase();
    const objects = database.collection("storageobjects");
    const object = await objects.findOne(objectFilter(input), { session });
    if (!object) throw new DriveUploadCommitError(409, "object_missing", "File is unavailable");
    if (object.revision !== input.baseRevision) throw new DriveUploadCommitError(409, "revision_conflict", "The file changed", object.revision);
    if (!Number.isSafeInteger(object.revision + 1) || object.versions?.length >= 256) {
      throw new DriveUploadCommitError(409, "version_cleanup_backlog", "Version cleanup must complete before another save");
    }
    const claimed = await DriveUploadSession.updateOne(
      { _id: manifest._id, status: "pending" }, { $set: { status: "completing" } }, { session },
    );
    if (claimed.modifiedCount !== 1) throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Revision was claimed");
    const { personal, usages, ownerFilter, usage } = await loadSpaceUsage(input.spaceId, input.shareId ? undefined : input.accountId, session);
    if (!Number.isSafeInteger(usage.totalStorageBytes + input.verifiedSize)) {
      throw new DriveUploadCommitError(409, "usage_not_initialized", "Storage usage is invalid");
    }
    const now = new Date();
    const charged = await usages.updateOne({
      ...ownerFilter,
      ...(usage.storageLimitBytes === null ? {} : { totalStorageBytes: { $lte: usage.storageLimitBytes - input.verifiedSize } }),
    }, { $inc: { totalStorageBytes: input.verifiedSize }, $set: { updatedAt: now, ...(personal ? { lastActiveAt: now } : {}) } }, { session });
    if (charged.modifiedCount !== 1) throw new DriveUploadCommitError(402, "storage_quota_exceeded", "Storage quota exceeded");
    const versions: Array<Record<string, unknown>> = (object.versions ?? []).map((version: Record<string, unknown>) => ({ ...version }));
    let original = versions.find((version) => version.isOriginal);
    if (!original) {
      original = { ...Object.fromEntries(contentFields.map((field) => [field, object[field]])),
        versionId: randomBytes(12).toString("hex"), isOriginal: true, createdAt: object.createdAt ?? now,
        createdBy: object.createdByAccountId };
      versions.push(original);
    }
    if (original.key === object.key) original.sharesCurrentContent = false;
    else versions.unshift({
      ...Object.fromEntries(contentFields.map((field) => [field, object[field]])),
      versionId: randomBytes(12).toString("hex"), createdAt: object.updatedAt ?? now, createdBy: input.accountId,
    });
    const active = versions.filter((version) => !version.pendingDeletion);
    const rolling = active.filter((version) => !version.isOriginal);
    for (const version of rolling.slice(MAX_RETAINED_VERSIONS - 1)) version.pendingDeletion = true;
    const revision = object.revision + 1;
    const updated = await objects.updateOne({ ...objectFilter(input), revision: input.baseRevision }, {
      $set: { key: manifest.fileId, size: input.verifiedSize, iv: manifest.revisionIv, b2FileId: input.b2FileId, versions, revision, updatedAt: now },
      $inc: { __v: 1 },
    }, { session });
    if (updated.modifiedCount !== 1) throw new DriveUploadCommitError(409, "revision_conflict", "The file changed");
    const bucket = await database.collection("buckets").updateOne({ _id: input.bucketId }, {
      $inc: { totalSizeBytes: input.verifiedSize }, $set: { updatedAt: now },
    }, { session });
    if (bucket.matchedCount !== 1) throw new DriveUploadCommitError(409, "bucket_missing", "Storage routing is unavailable");
    await DriveUploadSession.updateOne({ _id: manifest._id, status: "completing" }, {
      $set: { status: "completed", committedKeys: [manifest.fileId], committedRevision: revision },
    }, { session });
    return { revision, created: true };
  });
}
