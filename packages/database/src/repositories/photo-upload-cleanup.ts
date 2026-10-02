import { randomUUID } from "node:crypto";
import type { QueryFilter, Types } from "mongoose";
import { connectDatabase } from "../connection";
import { PhotoUpload, type PhotoUploadRecord } from "../models";
import { findReferencedStorageObjectKeys } from "./storage-objects";

interface PhotoUploadIdentity { uploadId: string; accountId: string; spaceId: string }
export const PHOTO_CLEANUP_LEASE_MS = 5 * 60 * 1000;

/** Cancellation fences completion immediately; physical cleanup waits for PUT expiry. */
export async function queuePhotoUploadAbort(input: PhotoUploadIdentity) {
  await connectDatabase();
  const manifest = await PhotoUpload.findOneAndUpdate({
    ...input, status: { $in: ["pending", "aborting"] },
  }, { $set: { status: "aborting" } }, { returnDocument: "after" }).lean();
  if (manifest) return { status: "queued" as const, cleanupAfter: manifest.expiresAt };
  const blocked = await PhotoUpload.exists({ ...input, status: "blocked" });
  return { status: blocked ? "blocked" as const : "unavailable" as const };
}

export function photoUploadCleanupFilter(now: Date): QueryFilter<PhotoUploadRecord> {
  return {
    status: { $in: ["pending", "aborting"] }, expiresAt: { $lte: now },
    $and: [
      { $or: [{ cleanupLeaseExpiresAt: { $exists: false } }, { cleanupLeaseExpiresAt: { $lte: now } }] },
      { $or: [{ cleanupNextAttemptAt: { $exists: false } }, { cleanupNextAttemptAt: { $lte: now } }] },
    ],
  };
}

type PhotoCleanupResult = { status: "deleted" | "blocked" | "retry" | "skipped"; keyCount: number };

/** Claim exact expired manifest keys; only confirmed deletion retires its current lease. */
export async function cleanupPhotoUploadRecord(input: PhotoUploadIdentity & {
  now?: Date;
  expiredAt?: Date;
  deleteBlobs: (target: { accountId: string; spaceId: string; bucketId: Types.ObjectId; keys: string[] }) => Promise<void>;
}): Promise<PhotoCleanupResult> {
  await connectDatabase();
  const now = input.now ?? new Date();
  const cutoff = input.expiredAt && input.expiredAt < now ? input.expiredAt : now;
  const leaseId = randomUUID();
  const manifest = await PhotoUpload.findOneAndUpdate({
    uploadId: input.uploadId, accountId: input.accountId, spaceId: input.spaceId,
    ...photoUploadCleanupFilter(cutoff),
  }, { $set: {
    status: "aborting", cleanupLeaseId: leaseId,
    cleanupLeaseExpiresAt: new Date(now.getTime() + PHOTO_CLEANUP_LEASE_MS),
  } }, { returnDocument: "after" }).lean();
  if (!manifest) return { status: "skipped", keyCount: 0 };
  const leaseFilter = { _id: manifest._id, status: "aborting" as const, cleanupLeaseId: leaseId };
  const keys = [manifest.original?.key, manifest.optimized?.key, manifest.thumbnail?.key]
    .filter((key): key is string => typeof key === "string");
  const block = async (reason: string): Promise<PhotoCleanupResult> => {
    const changed = await PhotoUpload.updateOne(leaseFilter, {
      $set: { status: "blocked", cleanupError: reason },
      $unset: { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1 },
    });
    return { status: changed.modifiedCount === 1 ? "blocked" : "skipped", keyCount: 0 };
  };
  const prefix = `users/${manifest.accountId}/`;
  const variantCount = 1 + Number(!!manifest.optimized) + Number(!!manifest.thumbnail);
  if (typeof manifest.original?.key !== "string" || keys.length !== variantCount || !keys.length || keys.length > 3 || new Set(keys).size !== keys.length ||
    keys.some((key) => !key.startsWith(prefix) || !/^[0-9a-f]{32}$/u.test(key.slice(prefix.length)))) {
    return block("invalid_manifest");
  }
  try {
    const referenced = await findReferencedStorageObjectKeys({ bucketId: manifest.bucketId, keys });
    if (referenced.size) return await block("keys_referenced");
    await input.deleteBlobs({ accountId: manifest.accountId, spaceId: manifest.spaceId, bucketId: manifest.bucketId, keys });
    const retired = await PhotoUpload.deleteOne({ ...leaseFilter, expiresAt: { $lte: cutoff } });
    return { status: retired.deletedCount === 1 ? "deleted" : "skipped", keyCount: retired.deletedCount === 1 ? keys.length : 0 };
  } catch {
    const released = await PhotoUpload.updateOne(leaseFilter, {
      $set: { cleanupError: "cleanup_failed", cleanupNextAttemptAt: new Date(now.getTime() + 60_000) },
      $unset: { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1 },
    });
    return { status: released.modifiedCount === 1 ? "retry" : "skipped", keyCount: 0 };
  }
}
