import { bucketExists, createB2Bucket } from "@/lib/b2/buckets";
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
  // Buckets are provisioned out-of-band (per region, by the account owner), so
  // treat this as ensure-if-missing and never let bucket provisioning 500 the
  // config route: verify existence first, and if creation errors in a way we
  // can't classify (e.g. an S3-compatible provider returning "UnknownError" on
  // CreateBucket) assume the bucket is externally managed and carry on.
  try {
    if (await bucketExists(name)) return name;
  } catch {
    // HeadBucket unsupported/errored — fall through and try to create.
  }
  try {
    await createB2Bucket(name);
  } catch (err) {
    if (isBucketAlreadyOwned(err)) return name;
    console.warn(
      `[storage] ensureWorkspaceBucket: could not verify/create bucket "${name}" ` +
        `(${(err as { name?: string })?.name ?? "error"}); assuming it is provisioned externally.`,
    );
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
