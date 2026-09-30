import { randomUUID } from "node:crypto";
import { type ClientSession, Types } from "mongoose";
import { isStorageRegion, resolveRegionBucketConfig } from "@xenode/config/storage";
import { connectDatabase, getDatabase, withTransaction } from "../connection";
import { DriveUploadCommitError, loadSpaceUsage } from "./drive-uploads";
import { findReferencedStorageObjectKeys, storedObjectBlobKeys, storageObjectTotalBytes } from "./storage-objects";

export const BIN_BATCH_LIMIT = 100;
export const BIN_PURGE_LEASE_MS = 5 * 60 * 1000;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
interface BinSelection { spaceId: string; bucketId: Types.ObjectId; ids?: Types.ObjectId[]; all?: boolean; cutoff?: Date; includeRelated?: boolean }

async function selectBinned(input: BinSelection, session?: ClientSession) {
  const objects = getDatabase().collection("storageobjects");
  const base = { productId: "drive", spaceId: input.spaceId, bucketId: input.bucketId, deletedAt: { $type: "date" as const, ...(input.cutoff ? { $lte: input.cutoff } : {}) } };
  const primaries = await objects.find({ ...base, ...(input.all ? { purgeState: { $exists: false } } : { _id: { $in: input.ids ?? [] } }) }, { session })
    .sort({ deletedAt: 1, _id: 1 }).limit(BIN_BATCH_LIMIT + 1).toArray();
  if (input.all) return primaries.slice(0, BIN_BATCH_LIMIT);
  if (input.includeRelated === false) return primaries;
  const prefixes = primaries.filter((object) => object.key?.endsWith("/")).map((object) => object.key as string);
  const children = prefixes.length ? await objects.find({ ...base, $or: prefixes.map((key) => ({ key: { $regex: `^${escapeRegex(key)}` } })) }, { session })
    .limit(BIN_BATCH_LIMIT + 1).toArray() : [];
  const selected = [...new Map([...primaries, ...children].map((object) => [String(object._id), object])).values()];
  const sidecars = await objects.find({ ...base, parentObjectId: { $in: selected.map((object) => object._id) } }, { session })
    .limit(BIN_BATCH_LIMIT + 1).toArray();
  const result = [...new Map([...selected, ...sidecars].map((object) => [String(object._id), object])).values()];
  if (result.length > BIN_BATCH_LIMIT) throw new DriveUploadCommitError(400, "bin_batch_limit", "Select at most 100 Bin objects, including folder children");
  return result;
}

export async function restoreDriveBin(input: BinSelection) {
  return withTransaction(async (session) => {
    const selected = await selectBinned(input, session);
    if (selected.some((object) => object.purgeState)) throw new DriveUploadCommitError(409, "purge_pending", "Permanent deletion has already started");
    if (!selected.length) return { restoredCount: 0 };
    await getDatabase().collection("storageobjects").updateMany({
      productId: "drive", spaceId: input.spaceId, bucketId: input.bucketId,
      _id: { $in: selected.map((object) => object._id) }, purgeState: { $exists: false }, deletedAt: { $type: "date" },
    }, { $unset: { deletedAt: "" }, $inc: { __v: 1 }, $set: { updatedAt: new Date() } }, { session });
    return { restoredCount: selected.length };
  });
}

/** Capture an immutable, permanently non-restorable deletion manifest. */
export async function queueDriveBinPurge(input: BinSelection) {
  return withTransaction(async (session) => {
    const objects = getDatabase().collection("storageobjects");
    const selected = await selectBinned(input, session);
    if (!selected.length) return [];
    if (selected.some((object) => object.versions?.some((version: { pendingDeletion?: boolean }) => version.pendingDeletion))) {
      throw new DriveUploadCommitError(409, "version_cleanup_pending", "Version deletion must finish before removing this file");
    }
    const { personal, ownerFilter } = await loadSpaceUsage(input.spaceId, undefined, session, true);
    const ownerId = personal ? ownerFilter.userId : ownerFilter.orgId;
    const bucket = await getDatabase().collection("buckets").findOne({ _id: input.bucketId }, { session });
    if (!bucket || !isStorageRegion(bucket.storageRegion) || resolveRegionBucketConfig(bucket.storageRegion).bucketName !== bucket.b2BucketId) {
      throw new DriveUploadCommitError(409, "bucket_missing", "Storage routing is unavailable");
    }
    for (const object of selected) {
      if (object.purgeState) continue;
      const keys = storedObjectBlobKeys(object);
      const bytes = storageObjectTotalBytes({ size: object.size, thumbnailSize: object.thumbnailSize, optimizedSize: object.optimizedSize, versions: object.versions });
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new DriveUploadCommitError(409, "invalid_storage_bytes", "Storage byte accounting is invalid");
      // Respect every known PUT grace window, including retained revision uploads.
      const upload = keys.length ? await getDatabase().collection("uploadsessions").find({
        bucketId: input.bucketId, keys: { $in: keys },
      }, { session }).sort({ expiresAt: -1 }).limit(1).next() : null;
      const purgeAfter = upload?.expiresAt instanceof Date && upload.expiresAt > new Date() ? upload.expiresAt : new Date(0);
      await objects.updateOne({ _id: object._id, ...{ productId: "drive", spaceId: input.spaceId }, purgeState: { $exists: false }, deletedAt: { $type: "date" } }, {
        $set: {
          purgeState: "pending", purgeKeys: keys, purgeBytes: bytes, purgeAfter,
          purgeOwnerCollection: personal ? "usages" : "orgusages", purgeOwnerId: ownerId, updatedAt: new Date(),
        }, $inc: { __v: 1 },
      }, { session });
    }
    return selected.map((object) => object._id);
  });
}

/** Confirm physical deletion before one atomic metadata/accounting retirement. */
export async function cleanupDriveBinObject(input: { objectId: Types.ObjectId; now?: Date; deleteBlobs: (bucketName: string, keys: string[]) => Promise<void> }) {
  await connectDatabase();
  const objects = getDatabase().collection("storageobjects"), now = input.now ?? new Date(), leaseId = randomUUID();
  const object = await objects.findOneAndUpdate({
    _id: input.objectId, productId: "drive", purgeState: "pending", deletedAt: { $type: "date" }, purgeAfter: { $lte: now },
    $and: [
      { $or: [{ purgeLeaseExpiresAt: { $exists: false } }, { purgeLeaseExpiresAt: { $lte: now } }] },
      { $or: [{ purgeNextAttemptAt: { $exists: false } }, { purgeNextAttemptAt: { $lte: now } }] },
    ],
  }, { $set: { purgeLeaseId: leaseId, purgeLeaseExpiresAt: new Date(now.getTime() + BIN_PURGE_LEASE_MS) }, $inc: { __v: 1 } }, { returnDocument: "after" });
  if (!object) return "skipped" as const;
  const lease = { _id: object._id, productId: "drive", spaceId: object.spaceId, purgeState: "pending", purgeLeaseId: leaseId };
  try {
    const keys = object.purgeKeys as string[];
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || !key)) throw new Error("invalid_purge_manifest");
    const references = await findReferencedStorageObjectKeys({ bucketId: object.bucketId, keys, ignoreObjectIds: [String(object._id)] });
    if (references.size) {
      await objects.updateOne(lease, { $set: { purgeState: "blocked", purgeError: "keys_referenced" }, $unset: { purgeLeaseId: "", purgeLeaseExpiresAt: "" } });
      return "blocked" as const;
    }
    const bucket = await getDatabase().collection("buckets").findOne({ _id: object.bucketId });
    if (!bucket || !isStorageRegion(bucket.storageRegion) || resolveRegionBucketConfig(bucket.storageRegion).bucketName !== bucket.b2BucketId) throw new Error("bucket_missing");
    if (keys.length) await input.deleteBlobs(bucket.b2BucketId, keys);
    return await withTransaction(async (session) => {
      const current = await objects.findOne(lease, { session });
      if (!current) return "skipped" as const;
      const bytes = current.purgeBytes;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || !["usages", "orgusages"].includes(current.purgeOwnerCollection) || typeof current.purgeOwnerId !== "string") throw new Error("invalid_purge_manifest");
      const usage = await getDatabase().collection(current.purgeOwnerCollection).updateOne({
        [current.purgeOwnerCollection === "usages" ? "userId" : "orgId"]: current.purgeOwnerId,
        totalStorageBytes: { $gte: bytes }, totalObjects: { $gte: 1 },
      }, { $inc: { totalStorageBytes: -bytes, totalObjects: -1 }, $set: { updatedAt: new Date() } }, { session });
      const bucketUpdate = await getDatabase().collection("buckets").updateOne({
        _id: current.bucketId, totalSizeBytes: { $gte: bytes }, objectCount: { $gte: 1 },
      }, { $inc: { totalSizeBytes: -bytes, objectCount: -1 }, $set: { updatedAt: new Date() } }, { session });
      if (usage.matchedCount !== 1 || bucketUpdate.matchedCount !== 1) throw new Error("accounting_unavailable");
      await getDatabase().collection("sharelinks").deleteMany({ objectId: current._id }, { session });
      await getDatabase().collection("directshares").deleteMany({ objectId: current._id }, { session });
      await getDatabase().collection("filecomments").deleteMany({ objectId: current._id }, { session });
      await getDatabase().collection("photoalbums").updateMany({ spaceId: current.spaceId }, [
        { $set: { objectIds: { $filter: { input: { $ifNull: ["$objectIds", []] }, as: "id", cond: { $ne: ["$$id", current._id] } } } } },
        { $set: { coverObjectId: { $cond: [{ $eq: ["$coverObjectId", current._id] }, { $ifNull: [{ $arrayElemAt: ["$objectIds", 0] }, null] }, "$coverObjectId"] } } },
      ], { session });
      await objects.deleteOne(lease, { session });
      return "deleted" as const;
    });
  } catch {
    await objects.updateOne(lease, {
      $set: { purgeError: "purge_failed", purgeNextAttemptAt: new Date(now.getTime() + 60_000) },
      $unset: { purgeLeaseId: "", purgeLeaseExpiresAt: "" },
    });
    return "retry" as const;
  }
}
