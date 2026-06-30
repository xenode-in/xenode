import { AuthzError } from "@/lib/authz";
import type { OrgRole } from "@/lib/auth/organization";
import {
  assertOrgMemberRole,
  type OrgMembership,
} from "@/lib/orgs/access";
import Bucket, { type IBucket } from "@/models/Bucket";

export type OrgStorageAction = "read" | "write" | "manage" | "delete";

const READ_WRITE_ROLES: OrgRole[] = ["owner", "admin", "manager", "member"];
const MANAGE_ROLES: OrgRole[] = ["owner", "admin", "manager"];
const ADMIN_ROLES: OrgRole[] = ["owner", "admin"];

export function orgStorageOwnerId(orgId: string): string {
  return `org:${orgId}`;
}

export function orgObjectKeyPrefix(orgId: string): string {
  // Immutable, workspace-scoped prefix inside the shared organization bucket.
  // The orgId never changes (unlike a name/slug), so keys stay stable.
  return `workspaces/${orgId}/objects/`;
}

export function orgBucketClause(orgId: string): Record<string, unknown> {
  return {
    ownerScope: "organization",
    orgId,
    teamId: { $in: [null, undefined, ""] },
  };
}

export function orgObjectClause(orgId: string): Record<string, unknown> {
  return {
    ownerScope: "organization",
    orgId,
    teamId: { $in: [null, undefined, ""] },
  };
}

export async function requireOrgStorageMembership(args: {
  userId: string;
  orgId: string;
  action?: OrgStorageAction;
}): Promise<OrgMembership> {
  const action = args.action ?? "read";
  const allowed =
    action === "delete" || action === "manage"
      ? action === "delete"
        ? ADMIN_ROLES
        : MANAGE_ROLES
      : READ_WRITE_ROLES;

  return assertOrgMemberRole({
    userId: args.userId,
    orgId: args.orgId,
    allowed,
  });
}

export function assertOrgObjectKey(args: { orgId: string; key: unknown }): string {
  if (typeof args.key !== "string" || !args.key) {
    throw new AuthzError(400, "object_key_required", "Object key is required");
  }
  if (!args.key.startsWith(orgObjectKeyPrefix(args.orgId))) {
    throw new AuthzError(
      403,
      "invalid_org_object_key",
      "Object key must stay inside this organization",
    );
  }
  return args.key;
}

export async function loadOrgBucket(args: {
  orgId: string;
  bucketId: string;
  action?: OrgStorageAction;
}): Promise<IBucket> {
  const bucket = await Bucket.findOne({
    _id: args.bucketId,
    ...orgBucketClause(args.orgId),
  });

  if (!bucket) {
    throw new AuthzError(404, "bucket_not_found", "Bucket not found");
  }
  return bucket;
}
