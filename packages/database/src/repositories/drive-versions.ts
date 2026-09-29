import { randomUUID, randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { isStorageRegion, resolveRegionBucketConfig } from "@xenode/config/storage";
import { connectDatabase, getDatabase, withTransaction } from "../connection";
import { DriveUploadCommitError, loadSpaceUsage } from "./drive-uploads";
import { contentFields, MAX_RETAINED_VERSIONS } from "./drive-revisions";
import { findReferencedStorageObjectKeys, storageObjectTotalBytes } from "./storage-objects";

interface VersionIdentity { objectId: Types.ObjectId; spaceId: string; versionId: string }
const objectFilter = (input: VersionIdentity) => ({ _id: input.objectId, spaceId: input.spaceId, productId: "drive" });
export const VERSION_CLEANUP_LEASE_MS = 5 * 60 * 1000;

export async function queueDriveVersionDeletion(input: VersionIdentity) {
  return withTransaction(async (session) => {
    const objects = getDatabase().collection("storageobjects");
    const object = await objects.findOne({ ...objectFilter(input), deletedAt: null }, { session });
    const version = object?.versions?.find((item: { versionId: string }) => item.versionId === input.versionId);
    if (!version) throw new DriveUploadCommitError(404, "version_missing", "Version is unavailable");
    if (version.isOriginal) throw new DriveUploadCommitError(409, "original_version_protected", "The protected original cannot be deleted");
    if (version.pendingDeletion) return;
    await objects.updateOne({ ...objectFilter(input), "versions.versionId": input.versionId }, {
      $set: { "versions.$.pendingDeletion": true }, $inc: { __v: 1 },
    }, { session });
  });
}

/** Restore metadata only, preserving all charged pending-deletion snapshots. */
export async function restoreDriveVersion(input: VersionIdentity & { accountId: string; baseRevision: number }) {
  return withTransaction(async (session) => {
    const objects = getDatabase().collection("storageobjects");
    const object = await objects.findOne({ ...objectFilter(input), deletedAt: null }, { session });
    if (!object) throw new DriveUploadCommitError(404, "object_missing", "File is unavailable");
    if (object.revision !== input.baseRevision) throw new DriveUploadCommitError(409, "revision_conflict", "The file changed", object.revision);
    const versions: Array<Record<string, unknown>> = (object.versions ?? []).map((item: Record<string, unknown>) => ({ ...item }));
    const target = versions.find((item) => item.versionId === input.versionId);
    if (!target) throw new DriveUploadCommitError(404, "version_missing", "Version is unavailable");
    if (target.pendingDeletion) throw new DriveUploadCommitError(409, "version_deletion_pending", "Version deletion is pending");
    const original = versions.find((item) => item.isOriginal);
    const snapshot = original?.key === object.key ? null : {
      ...Object.fromEntries(contentFields.map((field) => [field, object[field]])),
      versionId: randomBytes(12).toString("hex"), createdAt: new Date(), createdBy: input.accountId,
    };
    if (original) original.sharesCurrentContent = original.key === target.key;
    const remaining = target.isOriginal ? versions : versions.filter((item) => item !== target);
    if (snapshot) remaining.unshift(snapshot);
    const rolling = remaining.filter((item) => !item.isOriginal && !item.pendingDeletion);
    for (const item of rolling.slice(original ? MAX_RETAINED_VERSIONS - 1 : MAX_RETAINED_VERSIONS)) item.pendingDeletion = true;
    const update = Object.fromEntries(contentFields.map((field) => [field, target[field] ?? null]));
    const revision = object.revision + 1;
    if (!Number.isSafeInteger(revision) || remaining.length > 256) throw new DriveUploadCommitError(409, "version_cleanup_backlog", "Version cleanup must complete");
    await objects.updateOne({ ...objectFilter(input), revision: input.baseRevision, deletedAt: null }, {
      $set: { ...update, versions: remaining, revision, updatedAt: new Date() }, $inc: { __v: 1 },
    }, { session });
    return { revision };
  });
}

/** Claim an embedded snapshot; only the lease owner may retire its bytes. */
export async function cleanupDriveVersion(input: VersionIdentity & {
  now?: Date; deleteBlobs: (bucketName: string, keys: string[]) => Promise<void>;
}) {
  await connectDatabase();
  const now = input.now ?? new Date(), leaseId = randomUUID();
  const objects = getDatabase().collection("storageobjects");
  const object = await objects.findOneAndUpdate({
    ...objectFilter(input),
    versions: { $elemMatch: {
      versionId: input.versionId, pendingDeletion: true, isOriginal: { $ne: true }, deletionState: { $ne: "blocked" },
      $and: [
        { $or: [{ cleanupLeaseExpiresAt: { $exists: false } }, { cleanupLeaseExpiresAt: { $lte: now } }] },
        { $or: [{ cleanupNextAttemptAt: { $exists: false } }, { cleanupNextAttemptAt: { $lte: now } }] },
      ],
    } },
  }, {
    $set: { "versions.$.cleanupLeaseId": leaseId, "versions.$.cleanupLeaseExpiresAt": new Date(now.getTime() + VERSION_CLEANUP_LEASE_MS) },
    $inc: { __v: 1 },
  }, { returnDocument: "after" });
  if (!object) return "skipped" as const;
  const version = object.versions.find((item: { versionId: string }) => item.versionId === input.versionId);
  const leaseFilter = { ...objectFilter(input), versions: { $elemMatch: { versionId: input.versionId, cleanupLeaseId: leaseId, pendingDeletion: true, isOriginal: { $ne: true } } } };
  const keys = [...new Set<string>([version.key, ...(version.chunks ?? []).map((chunk: { key: string }) => chunk.key)].filter(Boolean))];
  try {
    const references = await findReferencedStorageObjectKeys({
      bucketId: object.bucketId, keys, ignoreVersion: { objectId: String(object._id), versionId: input.versionId },
    });
    if (references.size) {
      await objects.updateOne(leaseFilter, {
        $set: { "versions.$.deletionState": "blocked" },
        $unset: { "versions.$.cleanupLeaseId": "", "versions.$.cleanupLeaseExpiresAt": "" },
      });
      return "blocked" as const;
    }
    const bucket = await getDatabase().collection("buckets").findOne({ _id: object.bucketId });
    if (!bucket || typeof bucket.b2BucketId !== "string" || !isStorageRegion(bucket.storageRegion) ||
      resolveRegionBucketConfig(bucket.storageRegion).bucketName !== bucket.b2BucketId) throw new Error("bucket_missing");
    await input.deleteBlobs(bucket.b2BucketId, keys);
    return await withTransaction(async (session) => {
      const current = await objects.findOne(leaseFilter, { session });
      if (!current) return "skipped" as const;
      const bytes = storageObjectTotalBytes({ versions: [version] });
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("invalid_version_bytes");
      const { usages, ownerFilter } = await loadSpaceUsage(input.spaceId, undefined, session, true);
      const usage = await usages.updateOne({ ...ownerFilter, totalStorageBytes: { $gte: bytes } }, {
        $inc: { totalStorageBytes: -bytes }, $set: { updatedAt: new Date() },
      }, { session });
      const bucketUpdate = await getDatabase().collection("buckets").updateOne({ _id: object.bucketId, totalSizeBytes: { $gte: bytes } }, {
        $inc: { totalSizeBytes: -bytes }, $set: { updatedAt: new Date() },
      }, { session });
      if (usage.matchedCount !== 1 || bucketUpdate.matchedCount !== 1) throw new Error("accounting_unavailable");
      await objects.updateOne(leaseFilter, [
        { $set: {
          versions: { $filter: { input: "$versions", as: "version", cond: { $ne: ["$$version.versionId", input.versionId] } } },
          __v: { $add: [{ $ifNull: ["$__v", 0] }, 1] },
        } },
      ], { session });
      return "deleted" as const;
    });
  } catch {
    await objects.updateOne(leaseFilter, {
      $set: { "versions.$.cleanupNextAttemptAt": new Date(now.getTime() + 60_000) },
      $unset: { "versions.$.cleanupLeaseId": "", "versions.$.cleanupLeaseExpiresAt": "" },
    });
    return "retry" as const;
  }
}
