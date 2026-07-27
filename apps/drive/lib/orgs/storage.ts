import { AuthzError } from "@/lib/authz";
import type { OrgRole } from "@/lib/auth/organization";
import {
  assertOrgMemberRole,
  assertTeamMember,
  type OrgMembership,
} from "@/lib/orgs/access";
import Bucket, { type IBucket } from "@/models/Bucket";
import { organizationSpaceId, teamSpaceId } from "@xenode/spaces/ids";
import { resolveOrgStorageRegion } from "@/lib/storage/region";

export type OrgStorageAction = "read" | "write" | "manage" | "delete";

const READ_WRITE_ROLES: OrgRole[] = ["owner", "admin", "member"];
const MANAGE_ROLES: OrgRole[] = ["owner", "admin"];
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
  void orgId;
  // Single-system-bucket model (A8): all workspaces share one physical bucket;
  // tenant isolation is enforced on objects via `spaceId`, not per-bucket.
  return { systemKey: "drive" };
}

export function orgObjectClause(orgId: string): Record<string, unknown> {
  return { spaceId: organizationSpaceId(orgId) };
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
  const storageRegion = await resolveOrgStorageRegion(args.orgId);
  const bucket = await Bucket.findOne({
    _id: args.bucketId,
    systemKey: "drive",
    storageRegion,
  });

  if (!bucket) {
    throw new AuthzError(404, "bucket_not_found", "Bucket not found");
  }
  return bucket;
}

// ── Team drives ──────────────────────────────────────────────────────────────
// Team objects use their own Space while their physical keys remain nested
// under the organization prefix. Usage still rolls up to the organization.

export function teamObjectKeyPrefix(orgId: string, teamId: string): string {
  return `workspaces/${orgId}/teams/${teamId}/objects/`;
}

export function teamBucketClause(
  orgId: string,
  teamId: string,
): Record<string, unknown> {
  void orgId;
  void teamId;
  return { systemKey: "drive" };
}

export function teamObjectClause(
  orgId: string,
  teamId: string,
): Record<string, unknown> {
  return { spaceId: teamSpaceId(orgId, teamId) };
}

export function assertTeamObjectKey(args: {
  orgId: string;
  teamId: string;
  key: unknown;
}): string {
  if (typeof args.key !== "string" || !args.key) {
    throw new AuthzError(400, "object_key_required", "Object key is required");
  }
  if (!args.key.startsWith(teamObjectKeyPrefix(args.orgId, args.teamId))) {
    throw new AuthzError(
      403,
      "invalid_team_object_key",
      "Object key must stay inside this team",
    );
  }
  return args.key;
}

/**
 * Any member of the team may read/write its drive. Team creation/deletion is
 * gated separately at the org-admin level in the team CRUD routes.
 */
export async function requireTeamStorageMembership(args: {
  userId: string;
  orgId: string;
  teamId: string;
}): Promise<void> {
  await assertTeamMember({
    userId: args.userId,
    orgId: args.orgId,
    teamId: args.teamId,
  });
}

export async function loadTeamBucket(args: {
  orgId: string;
  teamId: string;
  bucketId: string;
}): Promise<IBucket> {
  const storageRegion = await resolveOrgStorageRegion(args.orgId);
  const bucket = await Bucket.findOne({
    _id: args.bucketId,
    systemKey: "drive",
    storageRegion,
  });

  if (!bucket) {
    throw new AuthzError(404, "bucket_not_found", "Bucket not found");
  }
  return bucket;
}
