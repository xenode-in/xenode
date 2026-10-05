import { bucketExists } from "@/lib/b2/buckets";
import Bucket, { type IBucket } from "@/models/Bucket";
import {
  DEFAULT_STORAGE_REGION, resolveRegionBucketConfig, validateStorageDeployment, type StorageRegion,
} from "@xenode/config/storage";

export type WorkspaceStorageType = "PERSONAL" | "ORGANIZATION";

/** Workspace type controls authorization; the pool controls physical storage. */
export function getBucketForWorkspace(
  type: WorkspaceStorageType,
  storageRegion: StorageRegion = DEFAULT_STORAGE_REGION,
): string {
  void type;
  return resolveRegionBucketConfig(storageRegion).bucketName;
}

export const systemWorkspaceBucketName = getBucketForWorkspace;

/** Buckets are pre-provisioned; a failed verification never creates a bucket. */
export async function ensureWorkspaceBucket(
  type: WorkspaceStorageType,
  storageRegion: StorageRegion = DEFAULT_STORAGE_REGION,
): Promise<string> {
  validateStorageDeployment();
  const name = getBucketForWorkspace(type, storageRegion);
  if (!await bucketExists(name, storageRegion)) throw new Error("Configured storage bucket is unavailable");
  return name;
}

function assertBucketMapping(bucket: IBucket, storageRegion: StorageRegion, bucketName: string) {
  if (bucket.systemKey !== "drive" || bucket.storageRegion !== storageRegion ||
    bucket.name !== bucketName || bucket.b2BucketId !== bucketName || bucket.region !== "auto") {
    throw new Error("Stored bucket mapping conflicts with deployment configuration; reset disposable development data");
  }
}

/** Creation-only metadata for the verified bucket; never relabel stored data. */
export async function ensureSystemWorkspaceBucketRecord(
  type: WorkspaceStorageType,
  storageRegion: StorageRegion = DEFAULT_STORAGE_REGION,
): Promise<IBucket> {
  const bucketName = await ensureWorkspaceBucket(type, storageRegion);
  await Bucket.init();
  const existing = await Bucket.findOne({ $or: [
    { systemKey: "drive", storageRegion }, { b2BucketId: bucketName },
  ] });
  if (existing) {
    assertBucketMapping(existing, storageRegion, bucketName);
    return existing;
  }
  try {
    return await Bucket.create({ systemKey: "drive", storageRegion, name: bucketName, b2BucketId: bucketName, region: "auto" });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
    const winner = await Bucket.findOne({ systemKey: "drive", storageRegion });
    if (!winner) throw error;
    assertBucketMapping(winner, storageRegion, bucketName);
    return winner;
  }
}
