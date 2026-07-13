import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import {
  isOrganizationFeatureEnabled,
  normalizeOrgRole,
  type OrgRole,
} from "@/lib/auth/organization";
import { AuthzError } from "@/lib/authz";

export interface OrganizationRecord {
  id: string;
  name: string;
  slug?: string;
  logo?: string | null;
  primaryColor?: string | null;
  emailBranding?: string | null;
  domainJoinPolicy?: "off" | "suggest" | "auto";
  autoJoinRequiresApproval?: boolean;
  /** Optional organization profile metadata collected at creation. */
  orgType?: string | null;
  teamSize?: string | null;
  website?: string | null;
  /** Soft-deletion marker. Set → org is scheduled for purge and inaccessible. */
  deletedAt?: Date | null;
  scheduledPurgeAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OrgMemberRecord {
  id?: string;
  organizationId: string;
  userId: string;
  role?: string | null;
  createdAt?: Date;
}

export interface TeamRecord {
  id: string;
  name: string;
  organizationId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserRecord {
  id?: string;
  _id?: unknown;
  email?: string;
  name?: string;
  image?: string | null;
}

export interface OrgMembership {
  organization: OrganizationRecord;
  member: OrgMemberRecord;
  role: OrgRole;
}

export function assertOrganizationsEnabled(): void {
  if (isOrganizationFeatureEnabled()) return;
  throw new AuthzError(
    404,
    "organizations_not_enabled",
    "Organizations are not enabled",
  );
}

export function assertOrgAdminRole(role: OrgRole): void {
  if (role === "owner" || role === "admin") return;
  throw new AuthzError(403, "organization_admin_required", "Forbidden");
}

export async function assertOrgMember(args: {
  userId: string;
  orgId: string;
}): Promise<OrgMembership> {
  assertOrganizationsEnabled();
  await dbConnect();

  const [organization, member] = await Promise.all([
    mongoose.connection
      .collection<OrganizationRecord>("organization")
      .findOne({ id: args.orgId }),
    mongoose.connection.collection<OrgMemberRecord>("member").findOne({
      userId: args.userId,
      organizationId: args.orgId,
    }),
  ]);

  if (!organization) {
    throw new AuthzError(404, "organization_not_found", "Organization not found");
  }
  if (organization.deletedAt) {
    throw new AuthzError(
      410,
      "organization_deleted",
      "This organization is scheduled for deletion",
    );
  }
  if (!member) {
    throw new AuthzError(
      403,
      "organization_membership_required",
      "Forbidden",
    );
  }

  return {
    organization,
    member,
    role: normalizeOrgRole(member.role),
  };
}

export async function assertOrgMemberRole(args: {
  userId: string;
  orgId: string;
  allowed: OrgRole[];
}): Promise<OrgMembership> {
  const membership = await assertOrgMember({
    userId: args.userId,
    orgId: args.orgId,
  });
  if (!args.allowed.includes(membership.role)) {
    throw new AuthzError(403, "organization_role_required", "Forbidden");
  }
  return membership;
}

export async function assertMemberInOrg(args: {
  userId: string;
  orgId: string;
}): Promise<OrgMemberRecord> {
  await dbConnect();
  const member = await mongoose.connection
    .collection<OrgMemberRecord>("member")
    .findOne({
      userId: args.userId,
      organizationId: args.orgId,
    });

  if (!member) {
    throw new AuthzError(
      400,
      "target_member_not_in_organization",
      "Target user is not a member of this organization",
    );
  }
  return member;
}

/**
 * Guard for account deletion / leaving: reject if `userId` is the SOLE owner of
 * any organization. An org must never be left ownerless — the user must transfer
 * ownership (or delete the org) first. Returns the list of blocking org ids.
 */
export async function assertNotSoleOwner(userId: string): Promise<void> {
  await dbConnect();
  const ownerMemberships = await mongoose.connection
    .collection<OrgMemberRecord>("member")
    .find({ userId, role: "owner" })
    .toArray();

  const blocking: string[] = [];
  for (const m of ownerMemberships) {
    const ownerCount = await mongoose.connection
      .collection<OrgMemberRecord>("member")
      .countDocuments({ organizationId: m.organizationId, role: "owner" });
    if (ownerCount <= 1) blocking.push(m.organizationId);
  }

  if (blocking.length > 0) {
    throw new AuthzError(
      409,
      "sole_owner_transfer_required",
      "Transfer ownership or delete these organizations before deleting your account",
    );
  }
}

export async function assertTeamInOrg(args: {
  orgId: string;
  teamId: string;
}): Promise<TeamRecord> {
  await dbConnect();
  const team = await mongoose.connection.collection<TeamRecord>("team").findOne({
    id: args.teamId,
    organizationId: args.orgId,
  });

  if (!team) {
    throw new AuthzError(404, "team_not_found", "Team not found");
  }
  return team;
}

export async function assertTeamMember(args: {
  userId: string;
  orgId: string;
  teamId: string;
}): Promise<void> {
  await assertTeamInOrg({ orgId: args.orgId, teamId: args.teamId });
  const teamMember = await mongoose.connection
    .collection("teamMember")
    .findOne({
      userId: args.userId,
      teamId: args.teamId,
    });

  if (!teamMember) {
    throw new AuthzError(403, "team_membership_required", "Forbidden");
  }
}
