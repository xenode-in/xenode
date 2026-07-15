import dbConnect from "@/lib/mongodb";
import StorageObject, { type IStorageObject } from "@/models/StorageObject";
import Bucket, { type IBucket } from "@/models/Bucket";
import { type AccessContext } from "./space-context";
import { AuthzError } from "./errors";
import { systemWorkspaceBucketName } from "@/lib/storage/workspaceBucket";

/**
 * Actions a caller may attempt on a resource.
 *
 * Under `personal` scope, ownership implies all actions. Under organization/team
 * scope, `assertScopeAction` below branches on the server-derived Space role.
 */
export type Action = "read" | "write" | "delete" | "share" | "manage";

/** Enforce the role attached to an already authenticated tenancy scope. */
export function assertScopeAction(ctx: AccessContext, action: Action): void {
  if (action === "read") return;
  const role = ctx.role;
  const mayWrite =
    role === "owner" ||
    role === "admin" ||
    role === "member";
  const mayManage = role === "owner" || role === "admin";
  if ((action === "write" && mayWrite) || (action !== "write" && mayManage)) {
    return;
  }
  throw new AuthzError(403, "workspace_role_required", "Forbidden");
}


/**
 * ── The ownership seam ───────────────────────────────────────────────────────
 * These builders return the Mongoose filter that scopes a query to what the
 * caller may access. Routes compose them with their own conditions (soft-delete,
 * projections, .lean(), etc.). Personal scope filters by `userId`; org/team scope
 * is handled by `objectOwnershipClause`/`bucketOwnershipClause` below. (Plan PR4
 * replaces both scope fields and these clauses with a single `spaceId`.)
 */

/**
 * Strict owner clause — the caller's own resources only (NO shared `system`
 * allowance). Use for owner-only mutations like deleting a bucket. Personal
 * scope today; org scope adds an $or on the future orgId field.
 */
export function ownerClause(ctx: AccessContext): Record<string, unknown> {
  return { spaceId: ctx.spaceId };
}

/** Ownership clause for a StorageObject query (excluding `_id`). */
export function objectOwnershipClause(ctx: AccessContext): Record<string, unknown> {
  return ownerClause(ctx);
}

/** Full filter for a single StorageObject the caller owns. */
export function objectFilter(
  ctx: AccessContext,
  objectId: string,
): Record<string, unknown> {
  return { _id: objectId, ...objectOwnershipClause(ctx) };
}

/**
 * Ownership clause for a Bucket query (excluding `_id`).
 *
 * Preserves the long-standing allowance that the shared `system` bucket is
 * readable/usable by everyone (used for app-managed folders, migrations, etc.).
 */
export function bucketOwnershipClause(ctx: AccessContext): Record<string, unknown> {
  return {
    systemKey: "drive",
    name: systemWorkspaceBucketName("PERSONAL"),
    b2BucketId: systemWorkspaceBucketName("PERSONAL"),
  };
}

/** Full filter for a single Bucket the caller owns (or the system bucket). */
export function bucketFilter(
  ctx: AccessContext,
  bucketId: string,
): Record<string, unknown> {
  return { _id: bucketId, ...bucketOwnershipClause(ctx) };
}

/**
 * Load a StorageObject the caller is allowed to act on, or throw AuthzError(404).
 *
 * Convenience for new routes that want the whole object. Existing routes can keep
 * their bespoke queries and just swap in `objectFilter(ctx, id)` for the
 * `{ _id, userId }` literal.
 *
 * @param action carried for forward-compat (org RBAC); not branched on yet.
 */
export async function assertObjectAccess(
  ctx: AccessContext,
  objectId: string,
  action: Action = "read",
  opts: { lean?: boolean } = {},
): Promise<IStorageObject> {
  assertScopeAction(ctx, action);
  await dbConnect();
  const query = StorageObject.findOne(objectFilter(ctx, objectId));
  const object = opts.lean
    ? ((await query.lean()) as IStorageObject | null)
    : await query;
  if (!object) {
    throw new AuthzError(404, "object_not_found", "Object not found");
  }
  return object;
}

/**
 * Load a Bucket the caller is allowed to act on, or throw AuthzError(404).
 *
 * @param action carried for forward-compat (org RBAC); not branched on yet.
 */
export async function assertBucketAccess(
  ctx: AccessContext,
  bucketId: string,
  action: Action = "read",
  opts: { lean?: boolean } = {},
): Promise<IBucket> {
  void action;
  await dbConnect();
  const query = Bucket.findOne(bucketFilter(ctx, bucketId));
  const bucket = opts.lean
    ? ((await query.lean()) as IBucket | null)
    : await query;
  if (!bucket) {
    throw new AuthzError(404, "bucket_not_found", "Bucket not found");
  }
  return bucket;
}
