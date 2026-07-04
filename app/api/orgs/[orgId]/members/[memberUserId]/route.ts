import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { normalizeOrgRole, type OrgRole } from "@/lib/auth/organization";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgAdminRole,
  assertOrgMember,
  type OrgMemberRecord,
} from "@/lib/orgs/access";
import { syncSeatsUsed } from "@/lib/orgs/billing/seats";
import OrgKeyGrant from "@/models/OrgKeyGrant";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; memberUserId: string }>;
}

interface RotationGrantInput {
  memberUserId?: unknown;
  wrappedSpaceKey?: unknown;
  keyVersion?: unknown;
}

interface TeamRecord {
  id: string;
  organizationId: string;
}

function normalizeRotationGrants(value: unknown): Array<{
  memberUserId: string;
  wrappedSpaceKey: string;
  keyVersion: number;
}> {
  if (!Array.isArray(value)) return [];
  return value.map((grant: RotationGrantInput) => ({
    memberUserId:
      typeof grant.memberUserId === "string" ? grant.memberUserId.trim() : "",
    wrappedSpaceKey:
      typeof grant.wrappedSpaceKey === "string"
        ? grant.wrappedSpaceKey.trim()
        : "",
    keyVersion: Number(grant.keyVersion),
  }));
}

function nonGuest(member: OrgMemberRecord): boolean {
  return normalizeOrgRole(member.role) !== "guest";
}

function assertCanRemoveTarget(args: {
  actorRole: OrgRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: OrgRole;
  ownerCount: number;
}) {
  if (args.actorUserId === args.targetUserId) {
    throw new AuthzError(
      400,
      "self_removal_not_supported",
      "Self-removal is not supported by this endpoint",
    );
  }
  if (args.targetRole === "owner" && args.actorRole !== "owner") {
    throw new AuthzError(403, "organization_owner_required", "Forbidden");
  }
  if (args.targetRole === "owner" && args.ownerCount <= 1) {
    throw new AuthzError(
      409,
      "last_owner_required",
      "Cannot remove the last organization owner",
    );
  }
}

function validateRotation(args: {
  targetRole: OrgRole;
  currentMaxKeyVersion: number;
  remainingKeyMembers: OrgMemberRecord[];
  rotationGrants: ReturnType<typeof normalizeRotationGrants>;
}) {
  if (args.targetRole === "guest") return null;

  if (args.rotationGrants.length === 0) {
    throw new AuthzError(
      400,
      "space_key_rotation_required",
      "Removing this member requires a rotated space key for remaining members",
    );
  }

  const expectedMembers = new Set(
    args.remainingKeyMembers.map((member) => member.userId),
  );
  const seen = new Set<string>();
  let nextKeyVersion: number | null = null;

  for (const grant of args.rotationGrants) {
    if (
      !grant.memberUserId ||
      !grant.wrappedSpaceKey ||
      !Number.isInteger(grant.keyVersion) ||
      grant.keyVersion < 1
    ) {
      throw new AuthzError(
        400,
        "invalid_rotation_grant",
        "Each rotation grant requires memberUserId, wrappedSpaceKey, and keyVersion",
      );
    }
    if (!expectedMembers.has(grant.memberUserId)) {
      throw new AuthzError(
        400,
        "rotation_grant_member_mismatch",
        "Rotation grants must cover only remaining organization members",
      );
    }
    if (seen.has(grant.memberUserId)) {
      throw new AuthzError(
        400,
        "duplicate_rotation_grant",
        "Duplicate rotation grant",
      );
    }
    seen.add(grant.memberUserId);
    nextKeyVersion ??= grant.keyVersion;
    if (nextKeyVersion !== grant.keyVersion) {
      throw new AuthzError(
        400,
        "rotation_key_version_mismatch",
        "Rotation grants must use the same key version",
      );
    }
  }

  if (seen.size !== expectedMembers.size) {
    throw new AuthzError(
      400,
      "rotation_grants_incomplete",
      "Rotation grants must cover every remaining non-guest member",
    );
  }
  if ((nextKeyVersion ?? 0) <= args.currentMaxKeyVersion) {
    throw new AuthzError(
      400,
      "rotation_key_version_not_newer",
      "Rotation key version must be newer than the current space key",
    );
  }

  return nextKeyVersion;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const mongoSession = await mongoose.startSession();

  try {
    const ctx = await requireAccessContext(request);
    const { orgId, memberUserId } = await params;
    const body = await request.json().catch(() => ({}));
    const rotationGrants = normalizeRotationGrants(body.rotationGrants);

    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    assertOrgAdminRole(membership.role);

    await dbConnect();
    const membersCollection =
      mongoose.connection.collection<OrgMemberRecord>("member");
    const [targetMember, allMembers, currentGrant] = await Promise.all([
      membersCollection.findOne({ organizationId: orgId, userId: memberUserId }),
      membersCollection.find({ organizationId: orgId }).toArray(),
      OrgKeyGrant.findOne({ orgId })
        .sort({ keyVersion: -1 })
        .select("keyVersion")
        .lean<{ keyVersion: number }>(),
    ]);

    if (!targetMember) {
      throw new AuthzError(404, "member_not_found", "Member not found");
    }

    const targetRole = normalizeOrgRole(targetMember.role);
    const ownerCount = allMembers.filter(
      (member) => normalizeOrgRole(member.role) === "owner",
    ).length;
    assertCanRemoveTarget({
      actorRole: membership.role,
      actorUserId: ctx.userId,
      targetUserId: memberUserId,
      targetRole,
      ownerCount,
    });

    const remainingMembers = allMembers.filter(
      (member) => member.userId !== memberUserId,
    );
    const remainingKeyMembers = remainingMembers.filter(nonGuest);
    const nextKeyVersion = validateRotation({
      targetRole,
      currentMaxKeyVersion: currentGrant?.keyVersion ?? 0,
      remainingKeyMembers,
      rotationGrants,
    });

    const now = new Date();
    await mongoSession.withTransaction(async () => {
      const teams = await mongoose.connection
        .collection<TeamRecord>("team")
        .find({ organizationId: orgId }, { session: mongoSession })
        .project({ id: 1, organizationId: 1 })
        .toArray();
      const teamIds = teams.map((team) => team.id);

      await membersCollection.deleteOne(
        { organizationId: orgId, userId: memberUserId },
        { session: mongoSession },
      );

      if (teamIds.length > 0) {
        await mongoose.connection.collection("teamMember").deleteMany(
          { userId: memberUserId, teamId: { $in: teamIds } },
          { session: mongoSession },
        );
      }

      await mongoose.connection.collection("session").updateMany(
        { userId: memberUserId, activeOrganizationId: orgId },
        {
          $unset: { activeOrganizationId: "", activeTeamId: "" },
          $set: { updatedAt: now },
        },
        { session: mongoSession },
      );

      await OrgKeyGrant.updateMany(
        { orgId, memberUserId, revokedAt: { $exists: false } },
        {
          $set: {
            revokedAt: now,
            rotationReason: "member_removed",
          },
        },
        { session: mongoSession },
      );

      if (nextKeyVersion) {
        const remainingIds = remainingKeyMembers.map((member) => member.userId);
        if (remainingIds.length > 0) {
          await OrgKeyGrant.updateMany(
            {
              orgId,
              memberUserId: { $in: remainingIds },
              keyVersion: { $lt: nextKeyVersion },
              revokedAt: { $exists: false },
              $or: [
                { teamId: { $exists: false } },
                { teamId: null },
                { teamId: "" },
              ],
            },
            {
              $set: {
                revokedAt: now,
                rotationReason: "member_removed",
              },
            },
            { session: mongoSession },
          );
        }

        for (const grant of rotationGrants) {
          await OrgKeyGrant.findOneAndUpdate(
            {
              orgId,
              teamId: null,
              memberUserId: grant.memberUserId,
              keyVersion: grant.keyVersion,
            },
            {
              $set: {
                orgId,
                teamId: null,
                memberUserId: grant.memberUserId,
                wrappedSpaceKey: grant.wrappedSpaceKey,
                keyVersion: grant.keyVersion,
                wrappedByUserId: ctx.userId,
                createdBy: ctx.userId,
                rotationReason: "member_removed",
              },
              $unset: { revokedAt: "" },
            },
            {
              new: true,
              upsert: true,
              setDefaultsOnInsert: true,
              session: mongoSession,
            },
          );
        }
      }
    });

    // Refresh the cached seat count now that a member is gone (best-effort).
    await syncSeatsUsed(orgId).catch(() => {});

    return NextResponse.json({
      removedMemberUserId: memberUserId,
      rotated: !!nextKeyVersion,
      keyVersion: nextKeyVersion,
      remainingMembers: remainingMembers.map((member) => ({
        userId: member.userId,
        role: normalizeOrgRole(member.role),
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to remove member";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await mongoSession.endSession();
  }
}
