import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { captureEvent } from "@/lib/posthog";

/**
 * Get or create usage record for a user.
 * NOTE: Only call this AFTER onboarding is complete.
 * During normal signup, /api/onboarding/complete creates the Usage doc.
 * This is a safety net for edge cases (e.g. admin tools, migrations).
 */
export async function getOrCreateUsage(userId: string) {
  await dbConnect();
  let usage = await Usage.findOne({ userId });
  if (!usage) {
    usage = await Usage.create({
      userId,
      plan: "free",
      storageLimitBytes: FREE_TIER_LIMIT_BYTES,
    });
  }
  return usage;
}

/**
 * Recalculate usage from source of truth (objects and buckets)
 */
export async function recalculateUsage(userId: string) {
  await dbConnect();

  const [storageAgg, objectCount, bucketCount] = await Promise.all([
    StorageObject.aggregate([
      { $match: { userId } },
      { $group: { _id: null, totalSize: { $sum: "$size" } } },
    ]),
    StorageObject.countDocuments({ userId }),
    Bucket.countDocuments({ userId }),
  ]);

  const totalStorageBytes = storageAgg[0]?.totalSize || 0;

  return Usage.findOneAndUpdate(
    { userId },
    {
      $set: {
        totalStorageBytes,
        totalObjects: objectCount,
        totalBuckets: bucketCount,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Increment storage usage when an object is uploaded.
 * GAP-2: Enforces quota ceiling BEFORE incrementing.
 *
 * Quota logic:
 *  - storageLimitBytes === null  → unlimited (paid plan), skip check
 *  - storageLimitBytes is a number → enforce hard ceiling
 */
export async function incrementStorage(
  userId: string,
  sizeBytes: number,
  meta?: { contentType?: string; bucketId?: string; isEncrypted?: boolean }
) {
  await dbConnect();

  const usage = await Usage.findOne({ userId });

  if (usage) {
    // Enforce plan expiry — downgrade to free if paid plan has expired
    if (
      usage.plan !== "free" &&
      usage.planExpiresAt &&
      usage.planExpiresAt < new Date()
    ) {
      await Usage.updateOne(
        { userId },
        {
          $set: {
            plan: "free",
            storageLimitBytes: FREE_TIER_LIMIT_BYTES,
            planPriceINR: 0,
          },
        },
      );
      usage.storageLimitBytes = FREE_TIER_LIMIT_BYTES;
    }

    // null storageLimitBytes = unlimited (active paid plan) — skip quota check
    if (usage.storageLimitBytes !== null) {
      const projectedUsage = (usage.totalStorageBytes || 0) + sizeBytes;
      if (projectedUsage > usage.storageLimitBytes) {
        throw new Error("QUOTA_EXCEEDED");
      }
    }
  }

  const updatedUsage = await Usage.findOneAndUpdate(
    { userId },
    {
      $inc: { totalStorageBytes: sizeBytes, totalObjects: 1, uploadCount: 1 },
      $set: { lastActiveAt: new Date() },
    },
    { upsert: true, new: true }
  );

  captureEvent(userId, "object_uploaded", {
    fileSizeMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
    contentType: meta?.isEncrypted ? "encrypted" : (meta?.contentType ?? "unknown"),
    bucketId: meta?.bucketId,
    isEncrypted: meta?.isEncrypted ?? false,
  });

  return updatedUsage;
}

/**
 * Decrement storage usage when an object is deleted
 */
export async function decrementStorage(userId: string, sizeBytes: number) {
  await dbConnect();

  return Usage.findOneAndUpdate(
    { userId },
    {
      $inc: { totalStorageBytes: -sizeBytes, totalObjects: -1 },
      $set: { lastActiveAt: new Date() },
    },
    { new: true }
  );
}

/**
 * Increment egress usage when an object is downloaded.
 */
export async function incrementEgress(
  userId: string,
  sizeBytes: number,
  meta?: { bucketId?: string }
) {
  await dbConnect();

  const usage = await Usage.findOneAndUpdate(
    { userId },
    {
      $inc: { totalEgressBytes: sizeBytes, downloadCount: 1 },
      $set: { lastActiveAt: new Date() },
    },
    { new: true }
  );

  captureEvent(userId, "object_downloaded", {
    fileSizeMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
    bucketId: meta?.bucketId,
  });

  return usage;
}

/**
 * Increment bucket count
 */
export async function incrementBucketCount(userId: string) {
  await dbConnect();
  return Usage.findOneAndUpdate(
    { userId },
    { $inc: { totalBuckets: 1 }, $set: { lastActiveAt: new Date() } },
    { upsert: true, new: true }
  );
}

/**
 * Decrement bucket count
 */
export async function decrementBucketCount(userId: string) {
  await dbConnect();
  return Usage.findOneAndUpdate(
    { userId },
    { $inc: { totalBuckets: -1 } },
    { new: true }
  );
}

/**
 * Update bucket-level object stats
 */
export async function updateBucketStats(
  bucketId: string,
  objectCountDelta: number,
  sizeDelta: number
) {
  await dbConnect();
  return Bucket.findByIdAndUpdate(
    bucketId,
    { $inc: { objectCount: objectCountDelta, totalSizeBytes: sizeDelta } },
    { new: true }
  );
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function bytesToGB(bytes: number): number {
  return Number((bytes / (1024 * 1024 * 1024)).toFixed(2));
}
