import type { ClientSession, Types } from "mongoose";
import { connectDatabase, getDatabase, withTransaction } from "../connection";
import { DriveUploadSession, Space } from "../models";
import { resolveNewDriveObjectPlacement } from "./drive-folders";

export class DriveUploadCommitError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly revision?: number) {
    super(message);
    this.name = "DriveUploadCommitError";
  }
}

export interface VerifiedDriveBlob { key: string; size: number }

export async function loadSpaceUsage(spaceId: string, accountId: string | undefined, session?: ClientSession, includeInactive = false) {
  // A shared Space write serializes a committed upload/revision with parent retirement.
  // Snapshot reads alone would allow a child commit after the parent saw an empty Space.
  if (session && !includeInactive) {
    const fenced = await Space.updateOne({ _id: spaceId, status: "active" }, { $inc: { storageFenceVersion: 1 } }, { session });
    if (fenced.matchedCount !== 1) {
      throw new DriveUploadCommitError(409, "space_owner_missing", "Space storage owner is unavailable");
    }
  }
  const space = await Space.findOne({ _id: spaceId, ...(includeInactive ? {} : { status: "active" }) }).session(session ?? null).lean();
  const personal = space?.type === "personal";
  const ownerId = personal ? space?.ownerAccountId : space?.organizationId;
  if (!ownerId || (personal && accountId !== undefined && ownerId !== accountId)) {
    throw new DriveUploadCommitError(409, "space_owner_missing", "Space storage owner is unavailable");
  }
  const usages = getDatabase().collection(personal ? "usages" : "orgusages");
  const ownerFilter = personal ? { userId: ownerId } : { orgId: ownerId };
  const usage = await usages.findOne(ownerFilter, { session });
  if (!usage || !Number.isSafeInteger(usage.totalStorageBytes) || usage.totalStorageBytes < 0 ||
    (usage.storageLimitBytes !== null && (!Number.isSafeInteger(usage.storageLimitBytes) || usage.storageLimitBytes < 0))) {
    throw new DriveUploadCommitError(409, "usage_not_initialized", "Storage usage and limit must be initialized");
  }
  return { personal, usages, ownerFilter, usage };
}

/** Read-only preflight; authoritative quota is reserved by finalization's transaction. */
export async function assertDriveUploadHeadroom(input: { spaceId: string; accountId: string; additionalBytes: number }) {
  await connectDatabase();
  const { usage } = await loadSpaceUsage(input.spaceId, input.accountId);
  if (!Number.isSafeInteger(input.additionalBytes) || input.additionalBytes < 1 ||
    !Number.isSafeInteger(usage.totalStorageBytes + input.additionalBytes)) {
    throw new DriveUploadCommitError(400, "invalid_upload_size", "Invalid upload size");
  }
  if (usage.storageLimitBytes !== null && usage.totalStorageBytes + input.additionalBytes > usage.storageLimitBytes) {
    throw new DriveUploadCommitError(402, "storage_quota_exceeded", "Storage quota exceeded");
  }
}

/** Commit verified ciphertext, its owner counters and its reservation together. */
export async function commitDriveUpload(input: {
  sessionId: string;
  accountId: string;
  spaceId: string;
  bucketId: Types.ObjectId;
  storageObject: Record<string, unknown>;
  verifiedBlobs: VerifiedDriveBlob[];
  /** Destination folder (null or absent for the Space root). */
  folderId?: unknown;
}) {
  const fileId = input.storageObject.key;
  if (typeof fileId !== "string") {
    throw new DriveUploadCommitError(409, "upload_manifest_mismatch", "Upload key is missing");
  }
  try {
    return await withTransaction(async (session) => {
      const manifest = await DriveUploadSession.findOne({
        _id: input.sessionId, userId: input.accountId, spaceId: input.spaceId,
        bucketId: input.bucketId, fileId, purpose: "create",
      }).session(session).lean();
      if (!manifest) {
        throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Upload reservation is missing");
      }
      const database = getDatabase();
      const objects = database.collection("storageobjects");
      const identity = {
        _id: manifest._id, productId: "drive", spaceId: input.spaceId,
        bucketId: manifest.bucketId, key: manifest.fileId, createdByAccountId: input.accountId,
      };
      if (manifest.status === "completed") {
        const existing = await objects.findOne({ ...identity, deletedAt: null }, { session });
        if (existing) return { object: existing, created: false };
      }
      if (manifest.status !== "pending" || manifest.expiresAt <= new Date()) {
        throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Upload is no longer pending");
      }
      const claimed = new Set(manifest.keys);
      const blobKeys = new Set(input.verifiedBlobs.map((blob) => blob.key));
      const verifiedByKey = new Map(input.verifiedBlobs.map((blob) => [blob.key, blob.size]));
      const totalBytes = input.verifiedBlobs.reduce((sum, blob) => sum + blob.size, 0);
      const chunks = input.storageObject.chunks as Array<VerifiedDriveBlob> | undefined;
      const mainBlobs = chunks?.length ? chunks : [{ key: manifest.fileId, size: input.storageObject.size as number }];
      const expectedBlobs = [
        ...mainBlobs,
        ...(input.storageObject.optimizedKey ? [{ key: input.storageObject.optimizedKey, size: input.storageObject.optimizedSize }] : []),
        ...(input.storageObject.thumbnail ? [{ key: input.storageObject.thumbnail, size: input.storageObject.thumbnailSize }] : []),
      ];
      if (input.storageObject.isEncrypted !== true ||
        typeof input.storageObject.encryptedDEK !== "string" || !input.storageObject.encryptedDEK ||
        typeof input.storageObject.encryptedName !== "string" || !input.storageObject.encryptedName ||
        !Number.isSafeInteger(totalBytes) || totalBytes < 1 ||
        blobKeys.size !== input.verifiedBlobs.length ||
        expectedBlobs.length !== input.verifiedBlobs.length ||
        new Set(expectedBlobs.map((blob) => blob.key)).size !== expectedBlobs.length ||
        mainBlobs.reduce((sum, blob) => sum + blob.size, 0) !== input.storageObject.size ||
        input.verifiedBlobs.some((blob) => !claimed.has(blob.key) || !Number.isSafeInteger(blob.size) || blob.size < 1) ||
        expectedBlobs.some((blob) => verifiedByKey.get(blob.key as string) !== blob.size)) {
        throw new DriveUploadCommitError(409, "upload_manifest_mismatch", "Verified blobs do not match the upload metadata");
      }
      const { personal, usages, ownerFilter, usage } = await loadSpaceUsage(input.spaceId, input.accountId, session);
      const claim = await DriveUploadSession.updateOne(
        { _id: manifest._id, status: "pending" }, { $set: { status: "completing" } }, { session },
      );
      if (claim.modifiedCount !== 1) {
        throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Upload was claimed by another operation");
      }
      if (!Number.isSafeInteger(usage.totalStorageBytes + totalBytes)) {
        throw new DriveUploadCommitError(409, "usage_not_initialized", "Storage usage and limit must be initialized");
      }
      const now = new Date();
      const quotaFilter = usage.storageLimitBytes === null ? ownerFilter : {
        ...ownerFilter, totalStorageBytes: { $lte: usage.storageLimitBytes - totalBytes },
      };
      const reserved = await usages.updateOne(quotaFilter, {
        $inc: { totalStorageBytes: totalBytes, totalObjects: 1, ...(personal ? { uploadCount: 1 } : {}) },
        $set: { updatedAt: now, ...(personal ? { lastActiveAt: now } : {}) },
      }, { session });
      if (reserved.modifiedCount !== 1) {
        throw new DriveUploadCommitError(402, "storage_quota_exceeded", "Storage quota exceeded");
      }
      const placement = await resolveNewDriveObjectPlacement(input.spaceId, input.storageObject, input.folderId, session);
      const object = { ...input.storageObject, ...identity, ...placement, __v: 0, createdAt: now, updatedAt: now };
      await objects.insertOne(object, { session });
      const bucket = await database.collection("buckets").updateOne(
        { _id: manifest.bucketId },
        { $inc: { objectCount: 1, totalSizeBytes: totalBytes }, $set: { updatedAt: now } }, { session },
      );
      if (bucket.matchedCount !== 1) {
        throw new DriveUploadCommitError(409, "bucket_missing", "Regional bucket metadata is missing");
      }
      const completed = await DriveUploadSession.updateOne(
        { _id: manifest._id, status: "completing" }, { $set: {
          status: "completed", committedKeys: [...new Set([manifest.fileId, ...blobKeys])],
          cleanupState: "pending",
        } }, { session },
      );
      if (completed.modifiedCount !== 1) {
        throw new DriveUploadCommitError(409, "upload_reservation_conflict", "Upload claim disappeared");
      }
      return { object, created: true };
    });
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new DriveUploadCommitError(409, "object_identity_conflict", "Object key or content fingerprint is already completed");
    }
    throw error;
  }
}
