import dbConnect from "@/lib/mongodb";
import StorageObject, { type IStorageObject } from "@/models/StorageObject";
import Bucket, { type IBucket } from "@/models/Bucket";
import { type AccessContext } from "./context";
import { AuthzError } from "./errors";
import { orgObjectClause, teamObjectClause } from "@/lib/orgs/storage";
import { systemWorkspaceBucketName } from "@/lib/storage/workspaceBucket";

/**
 * Actions a caller may attempt on a resource.
 *
 * Today, under `personal` scope, ownership implies all actions — `action` is
 * carried through but not yet branched on. When Organizations land, this union
 * maps onto better-auth access-control statements so org roles (owner/admin/
 * member/viewer) can be enforced per action without touching call sites.
 */
export type Action = "read" | "write" | "delete" | "share" | "manage";

function assertPersonalStorageScope(ctx: AccessContext): void {
  if (ctx.scope.type === "personal") return;
  throw new AuthzError(
    501,
    "organization_storage_not_ready",
    "Organization storage is not enabled yet",
  );
}

/**
 * ── The ownership seam ───────────────────────────────────────────────────────
 * These builders return the Mongoose filter that scopes a query to what the
 * caller may access. Routes compose them with their own conditions (soft-delete,
 * projections, .lean(), etc.), so adopting them is low-risk and behavior-
 * preserving. When orgs arrive, ONLY these two functions change:
 *   personal:     { userId: ctx.userId }
 *   organization: { $or: [{ userId: ctx.userId }, { orgId: ctx.scope.orgId }] }
 */

/**
 * Strict owner clause — the caller's own resources only (NO shared `system`
 * allowance). Use for owner-only mutations like deleting a bucket. Personal
 * scope today; org scope adds an $or on the future orgId field.
 */
export function ownerClause(ctx: AccessContext): Record<string, unknown> {
  assertPersonalStorageScope(ctx);
  return { userId: ctx.userId };
}

/** Ownership clause for a StorageObject query (excluding `_id`). */
export function objectOwnershipClause(ctx: AccessContext): Record<string, unknown> {
  if (ctx.scope.type === "organization") {
    return orgObjectClause(ctx.scope.orgId);
  }
  if (ctx.scope.type === "team") {
    return teamObjectClause(ctx.scope.orgId, ctx.scope.teamId);
  }
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
  if (ctx.scope.type === "organization" || ctx.scope.type === "team") {
    return {
      userId: "system",
      name: systemWorkspaceBucketName("ORGANIZATION"),
      b2BucketId: systemWorkspaceBucketName("ORGANIZATION"),
    };
  }
  assertPersonalStorageScope(ctx);
  return { $or: [{ userId: ctx.userId }, { userId: "system" }] };
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
  void action;
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
