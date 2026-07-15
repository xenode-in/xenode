import { createB2Bucket } from "@/lib/b2/buckets";
import Bucket, { type IBucket } from "@/models/Bucket";
import { resolveSystemBucketConfig } from "@xenode/config/storage";

/**
 * Storage-bucket selector for the single-system-bucket model.
 *
 * Xenode uses one shared Backblaze B2 bucket and isolates tenants by immutable
 * object-key prefixes. Workspace type remains an authorization concern, not a
 * physical-bucket selector.
 * Never hardcode a bucket name; always resolve it here.
 */
export type WorkspaceStorageType = "PERSONAL" | "ORGANIZATION";

/**
 * The B2 bucket name backing a workspace type. Stored as `Bucket.b2BucketId`
 * (B2's S3 API addresses buckets by name). Env-driven, with safe defaults.
 */
export function getBucketForWorkspace(type: WorkspaceStorageType): string {
  void type;
  return resolveSystemBucketConfig().bucketName;
}

export function systemWorkspaceBucketName(type: WorkspaceStorageType): string {
  return getBucketForWorkspace(type);
}

function isBucketAlreadyOwned(err: unknown): boolean {
  const e = err as { Code?: string; name?: string } | null;
  return (
    e?.Code === "BucketAlreadyOwnedByYou" ||
    e?.name === "BucketAlreadyOwnedByYou"
  );
}

function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: number } | null;
  return e?.code === 11000;
}

/**
 * Idempotently ensure the shared B2 bucket for a workspace type exists.
 *
 * Mirrors the lazy create-on-first-use in `app/api/drive/config` for personal
 * storage. Called once when an organization is created (the first org-storage
 * touch point) rather than per-org. No-op under tests. Returns the resolved
 * bucket name to store as `Bucket.b2BucketId`.
 */
export async function ensureWorkspaceBucket(
  type: WorkspaceStorageType,
): Promise<string> {
  const name = getBucketForWorkspace(type);
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return name;
  }
  try {
    await createB2Bucket(name);
  } catch (err) {
    // Already provisioned (by us) is the steady state — ignore. Any other
    // error (e.g. the name is taken by a different account) is a real config
    // problem and should surface to the caller.
    if (!isBucketAlreadyOwned(err)) throw err;
  }
  return name;
}

/**
 * Ensure the singleton Mongo bucket document for a shared physical workspace
 * bucket exists. This mirrors the existing system-owned personal bucket row:
 * `{ userId: "system", name: bucketName, b2BucketId: bucketName }`.
 */
export async function ensureSystemWorkspaceBucketRecord(
  type: WorkspaceStorageType,
): Promise<IBucket> {
  const bucketName = await ensureWorkspaceBucket(type);
  const existing = await Bucket.findOne({
    $or: [{ systemKey: "drive" }, { b2BucketId: bucketName }],
  });
  if (existing) {
    if (
      existing.systemKey !== "drive" ||
      existing.name !== bucketName ||
      existing.b2BucketId !== bucketName
    ) {
      await Bucket.updateOne(
        { _id: existing._id },
        {
          $set: {
            systemKey: "drive",
            name: bucketName,
            b2BucketId: bucketName,
          },
          $unset: {
            userId: "",
            ownerScope: "",
            orgId: "",
            teamId: "",
            createdBy: "",
          },
        },
      );
      const normalized = await Bucket.findById(existing._id);
      if (normalized) return normalized;
    }
    return existing;
  }

  try {
    return await Bucket.create({
      systemKey: "drive",
      name: bucketName,
      b2BucketId: bucketName,
      region: resolveSystemBucketConfig().region,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const existingAfterRace = await Bucket.findOne({ b2BucketId: bucketName });
    if (existingAfterRace) return existingAfterRace;
    throw err;
  }
}
