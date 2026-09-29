import { randomUUID } from "node:crypto";
import type { QueryFilter } from "mongoose";
import { isStorageRegion, type StorageRegion } from "@xenode/config/storage";
import { connectDatabase, getDatabase } from "../connection";
import { DriveUploadSession, type DriveUploadSessionRecord } from "../models";
import { findReferencedStorageObjectKeys } from "./storage-objects";

export const DRIVE_CLEANUP_LEASE_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_KEYS = 4099;

export function driveUploadCleanupFilter(now: Date): QueryFilter<DriveUploadSessionRecord> {
  return {
    status: { $in: ["pending", "cleaning", "completed"] },
    cleanupState: { $in: ["pending", "cleaning"] },
    expiresAt: { $lte: now },
    $and: [
      { $or: [{ cleanupLeaseExpiresAt: { $exists: false } }, { cleanupLeaseExpiresAt: { $lte: now } }] },
      { $or: [{ cleanupNextAttemptAt: { $exists: false } }, { cleanupNextAttemptAt: { $lte: now } }] },
    ],
  };
}

type CleanupResult = { status: "deleted" | "reconciled" | "blocked" | "retry" | "skipped"; keyCount: number };

/** Serialize orphan deletion with finalization/renewal on the manifest itself. */
export async function cleanupDriveUpload(input: {
  sessionId: string;
  now?: Date;
  deleteBlobs: (target: { bucketName: string; region: StorageRegion; keys: string[] }) => Promise<void>;
}): Promise<CleanupResult> {
  await connectDatabase();
  const now = input.now ?? new Date();
  const eligible = driveUploadCleanupFilter(now);
  const candidate = await DriveUploadSession.findOne({ _id: input.sessionId, ...eligible }).select("status").lean();
  if (!candidate) return { status: "skipped", keyCount: 0 };
  const leaseId = randomUUID();
  const claimed = await DriveUploadSession.findOneAndUpdate(
    { _id: candidate._id, ...eligible, status: candidate.status },
    { $set: {
      status: candidate.status === "completed" ? "completed" : "cleaning",
      cleanupState: "cleaning", cleanupLeaseId: leaseId,
      cleanupLeaseExpiresAt: new Date(now.getTime() + DRIVE_CLEANUP_LEASE_MS),
    } },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) return { status: "skipped", keyCount: 0 };
  const leaseFilter = { _id: claimed._id, cleanupLeaseId: leaseId, cleanupState: "cleaning" as const };
  const release = { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1, cleanupNextAttemptAt: 1 } as const;
  const completed = claimed.status === "completed";
  const block = async (reason: string): Promise<CleanupResult> => {
    const result = await DriveUploadSession.updateOne(leaseFilter, {
      $set: { status: completed ? "completed" : "blocked", cleanupState: "blocked", cleanupError: reason },
      $unset: release,
    });
    return { status: result.modifiedCount === 1 ? "blocked" : "skipped", keyCount: 0 };
  };
  // No inferred prefix or caller-supplied key can authorize cleanup.
  const keys = Array.isArray(claimed.keys) ? [...new Set(claimed.keys)] : [];
  if (!keys.length || keys.length > MAX_KEYS || !keys.includes(claimed.fileId) ||
    keys.some((key) => typeof key !== "string" || !key) ||
    (completed && (!Array.isArray(claimed.committedKeys) || !claimed.committedKeys.includes(claimed.fileId) ||
      claimed.committedKeys.some((key) => !keys.includes(key))))) {
    return block("invalid_manifest");
  }
  const committedKeys = new Set(claimed.committedKeys);
  const cleanupKeys = completed ? keys.filter((key) => !committedKeys.has(key)) : keys;
  try {
    if (cleanupKeys.length) {
      const referenced = await findReferencedStorageObjectKeys({ bucketId: claimed.bucketId, keys: cleanupKeys });
      if (referenced.size) return await block("keys_referenced");
      const bucket = await getDatabase().collection("buckets").findOne(
        { _id: claimed.bucketId }, { projection: { b2BucketId: 1, storageRegion: 1 } },
      );
      if (!bucket || typeof bucket.b2BucketId !== "string" || !bucket.b2BucketId || !isStorageRegion(bucket.storageRegion)) {
        throw new Error("routing_unavailable");
      }
      await input.deleteBlobs({ bucketName: bucket.b2BucketId, region: bucket.storageRegion, keys: cleanupKeys });
    }
    if (completed) {
      const result = await DriveUploadSession.updateOne(leaseFilter, {
        $set: { cleanupState: "done", cleanupCompletedAt: now },
        $unset: { ...release, cleanupError: 1 },
      });
      return { status: result.modifiedCount === 1 ? "reconciled" : "skipped", keyCount: cleanupKeys.length };
    }
    // The physical delete must finish first; only the current lease can retire its ledger.
    const result = await DriveUploadSession.deleteOne({ ...leaseFilter, status: "cleaning" });
    return { status: result.deletedCount === 1 ? "deleted" : "skipped", keyCount: cleanupKeys.length };
  } catch {
    const result = await DriveUploadSession.updateOne(leaseFilter, {
      $set: { cleanupError: "cleanup_failed", cleanupNextAttemptAt: new Date(now.getTime() + RETRY_MS) },
      $unset: { cleanupLeaseId: 1, cleanupLeaseExpiresAt: 1 },
    });
    return { status: result.modifiedCount === 1 ? "retry" : "skipped", keyCount: 0 };
  }
}
