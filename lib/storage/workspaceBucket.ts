import { createB2Bucket } from "@/lib/b2/buckets";

/**
 * Storage-bucket selector for the two-bucket model.
 *
 * Xenode uses exactly TWO shared Backblaze B2 buckets — one for all personal
 * workspaces, one for all organization workspaces — and isolates tenants by an
 * immutable `workspaces/{workspaceId}/...` key prefix, NOT by a bucket per org.
 * Never hardcode a bucket name; always resolve it here.
 */
export type WorkspaceStorageType = "PERSONAL" | "ORGANIZATION";

/**
 * The B2 bucket name backing a workspace type. Stored as `Bucket.b2BucketId`
 * (B2's S3 API addresses buckets by name). Env-driven, with safe defaults.
 */
export function getBucketForWorkspace(type: WorkspaceStorageType): string {
  return type === "ORGANIZATION"
    ? process.env.ORGANIZATION_STORAGE_BUCKET || "xenode-organization-dev"
    : process.env.S3_BUCKET_NAME || "xenode-drive-storage";
}

function isBucketAlreadyOwned(err: unknown): boolean {
  const e = err as { Code?: string; name?: string } | null;
  return (
    e?.Code === "BucketAlreadyOwnedByYou" ||
    e?.name === "BucketAlreadyOwnedByYou"
  );
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
