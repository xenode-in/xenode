import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMemberRole, assertTeamInOrg } from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import OrgKeyGrant from "@/models/OrgKeyGrant";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string; memberUserId: string }>;
}

interface RotationGrant {
  memberUserId: string;
  wrappedSpaceKey: string;
  keyVersion: number;
}

function normalizeRotationGrants(value: unknown): RotationGrant[] {
  if (!Array.isArray(value)) return [];
  return value.map((g: Record<string, unknown>) => ({
    memberUserId: typeof g.memberUserId === "string" ? g.memberUserId.trim() : "",
    wrappedSpaceKey:
      typeof g.wrappedSpaceKey === "string" ? g.wrappedSpaceKey.trim() : "",
    keyVersion: Number(g.keyVersion),
  }));
}

/**
 * Validate that the rotation grants re-wrap the team key for EXACTLY the
 * remaining team members at a single new key version > the current max.
 * Returns the new key version, or null when the team has no remaining members.
 */
function validateTeamRotation(args: {
  remainingMemberIds: string[];
  currentMaxKeyVersion: number;
  rotationGrants: RotationGrant[];
}): number | null {
  if (args.remainingMemberIds.length === 0) return null;

  const expected = new Set(args.remainingMemberIds);
  const seen = new Set<string>();
  let nextKeyVersion: number | null = null;

  if (args.rotationGrants.length === 0) {
    throw new AuthzError(
      400,
      "team_key_rotation_required",
      "Removing this member requires a rotated team key for the remaining members",
    );
  }

  for (const grant of args.rotationGrants) {
    if (
      !grant.memberUserId ||
      !grant.wrappedSpaceKey ||
      !Number.isInteger(grant.keyVersion) ||
      grant.keyVersion < 1
    ) {
      throw new AuthzError(400, "invalid_rotation_grant", "Invalid rotation grant");
    }
    if (!expected.has(grant.memberUserId)) {
      throw new AuthzError(
        400,
        "rotation_grant_member_mismatch",
        "Rotation grants must cover only remaining team members",
      );
    }
    if (seen.has(grant.memberUserId)) {
      throw new AuthzError(400, "duplicate_rotation_grant", "Duplicate rotation grant");
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

  if (seen.size !== expected.size) {
    throw new AuthzError(
      400,
      "rotation_grants_incomplete",
      "Rotation grants must cover every remaining team member",
    );
  }
  if ((nextKeyVersion ?? 0) <= args.currentMaxKeyVersion) {
    throw new AuthzError(
      400,
      "rotation_key_version_not_newer",
      "Rotation key version must be newer than the current team key",
    );
  }
  return nextKeyVersion;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const mongoSession = await mongoose.startSession();
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId, memberUserId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin", "manager"],
    });
    await assertTeamInOrg({ orgId, teamId });

    const body = await request.json().catch(() => ({}));
    const rotationGrants = normalizeRotationGrants(body.rotationGrants);

    await dbConnect();
    const teamMembers = await mongoose.connection
      .collection("teamMember")
      .find({ teamId })
      .toArray();
    const target = teamMembers.find((tm) => tm.userId === memberUserId);
    if (!target) {
      throw new AuthzError(404, "team_member_not_found", "Team member not found");
    }

    const remainingMemberIds = teamMembers
      .map((tm) => tm.userId as string)
      .filter((id) => id !== memberUserId);

    const currentGrant = await OrgKeyGrant.findOne({ orgId, teamId })
      .sort({ keyVersion: -1 })
      .select("keyVersion")
      .lean<{ keyVersion: number }>();

    const nextKeyVersion = validateTeamRotation({
      remainingMemberIds,
      currentMaxKeyVersion: currentGrant?.keyVersion ?? 0,
      rotationGrants,
    });

    const now = new Date();
    await mongoSession.withTransaction(async () => {
      await mongoose.connection
        .collection("teamMember")
        .deleteOne({ teamId, userId: memberUserId }, { session: mongoSession });

      // Revoke the removed member's team grants.
      await OrgKeyGrant.updateMany(
        { orgId, teamId, memberUserId, revokedAt: { $exists: false } },
        { $set: { revokedAt: now, rotationReason: "member_removed" } },
        { session: mongoSession },
      );

      if (nextKeyVersion) {
        // Revoke pre-rotation grants for remaining members.
        await OrgKeyGrant.updateMany(
          {
            orgId,
            teamId,
            memberUserId: { $in: remainingMemberIds },
            keyVersion: { $lt: nextKeyVersion },
            revokedAt: { $exists: false },
          },
          { $set: { revokedAt: now, rotationReason: "member_removed" } },
          { session: mongoSession },
        );
        // Install the new-version grants.
        for (const grant of rotationGrants) {
          await OrgKeyGrant.findOneAndUpdate(
            { orgId, teamId, memberUserId: grant.memberUserId, keyVersion: grant.keyVersion },
            {
              $set: {
                orgId,
                teamId,
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

    await emitActivity({
      orgId,
      action: ActivityAction.TEAM_MEMBER_REMOVED,
      actorUserId: ctx.userId,
      target: { type: "team", id: teamId },
      metadata: { memberUserId, rotated: !!nextKeyVersion },
    });

    return NextResponse.json({
      removedMemberUserId: memberUserId,
      rotated: !!nextKeyVersion,
      keyVersion: nextKeyVersion,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to remove team member";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await mongoSession.endSession();
  }
}
