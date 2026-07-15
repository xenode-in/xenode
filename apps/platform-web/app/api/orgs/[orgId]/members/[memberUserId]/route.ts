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
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { recordMembershipDeparture } from "@/lib/orgs/membershipHistory";
import { emitNotification } from "@/lib/notifications/emit";
import {
  AuditEvent,
  ProductSession,
  Space,
} from "@xenode/database/models";
import { publishSyncEvent } from "@/lib/realtime/publish";
import { organizationSpaceId } from "@xenode/spaces/ids";
import {
  latestProductKeyVersion,
  putMemberProductKey,
  retireOlderProductKeys,
  revokeMemberProductKeys,
} from "@xenode/spaces/product-keys";

export const dynamic = "force-dynamic";

const REALTIME_PRODUCTS = [
  "drive",
  "photos",
  "mobile",
  "office-editor",
] as const;

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
    const [targetMember, allMembers] = await Promise.all([
      membersCollection.findOne({ organizationId: orgId, userId: memberUserId }),
      membersCollection.find({ organizationId: orgId }).toArray(),
    ]);
    const orgSpaceId = organizationSpaceId(orgId);
    const currentKeyVersion = await latestProductKeyVersion({
      spaceId: orgSpaceId,
      productId: "drive",
    });

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
      currentMaxKeyVersion: currentKeyVersion,
      remainingKeyMembers,
      rotationGrants,
    });

    const affectedSpaces = await Space.find({ organizationId: orgId })
      .select("_id")
      .lean<Array<{ _id: string }>>();
    const affectedSpaceIds = affectedSpaces.map((space) => space._id);
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

      await ProductSession.updateMany(
        {
          accountId: memberUserId,
          productId: { $in: ["drive", "photos", "mobile", "office-editor"] },
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: now }, $inc: { sessionVersion: 1 } },
        { session: mongoSession },
      );
      await revokeMemberProductKeys({
        spaceIds: affectedSpaceIds,
        memberAccountId: memberUserId,
        productIds: [
          "accounts",
          "drive",
          "photos",
          "mobile",
          "office-editor",
        ],
        rotationReason: "member_removed",
        session: mongoSession,
      });

      if (nextKeyVersion) {
        const remainingIds = remainingKeyMembers.map((member) => member.userId);
        await retireOlderProductKeys({
          spaceId: orgSpaceId,
          productId: "drive",
          memberAccountIds: remainingIds,
          keyVersion: nextKeyVersion,
          rotationReason: "member_removed",
          session: mongoSession,
        });
        for (const grant of rotationGrants) {
          await putMemberProductKey({
            spaceId: orgSpaceId,
            productId: "drive",
            memberAccountId: grant.memberUserId,
            wrappedKey: grant.wrappedSpaceKey,
            keyVersion: grant.keyVersion,
            createdByAccountId: ctx.accountId,
            rotationReason: "member_removed",
            session: mongoSession,
          });
        }
      }
    });

    // Refresh the cached seat count now that a member is gone (best-effort).
    await syncSeatsUsed(orgId).catch(() => {});

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_REMOVED,
      actorUserId: ctx.userId,
      target: { type: "member", id: memberUserId },
      metadata: { role: targetRole, rotated: !!nextKeyVersion },
    });

    // Tombstone the departure so a future re-invite of the same email is
    // flagged (fire-and-forget — never blocks removal).
    await recordMembershipDeparture({
      orgId,
      userId: memberUserId,
      role: targetRole,
      joinedAt: targetMember.createdAt ?? null,
      removedBy: ctx.userId,
      reason: "removed",
    });

    await Promise.all(
      affectedSpaceIds.flatMap((spaceId) =>
        REALTIME_PRODUCTS.map((productId) =>
          publishSyncEvent({
            userId: memberUserId,
            productId,
            spaceId,
            type: "ACCESS_REVOKED",
            payload: { reason: "organization_member_removed" },
          }),
        ),
      ),
    ).catch(() => undefined);

    await AuditEvent.create({
      accountId: memberUserId,
      spaceId: affectedSpaceIds[0],
      productId: "accounts",
      action: "organization.member_removed",
      metadata: { organizationId: orgId, removedBy: ctx.userId },
    }).catch(() => undefined);

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

const ASSIGNABLE_ROLES: OrgRole[] = ["admin", "member", "guest"];

/**
 * PATCH /api/orgs/[orgId]/members/[memberUserId] — change a member's role.
 *
 * Owner/admin only. Owner role is managed via ownership transfer, not here.
 * E2EE: rotation is driven by crossing the guest boundary —
 *   - non-guest → guest: revoke their grant + rotate the space key (rotationGrants required)
 *   - guest → non-guest: install a fresh wrapped grant (no version bump)
 *   - admin ↔ member: no key change.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const mongoSession = await mongoose.startSession();
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, memberUserId } = await params;
    const body = await request.json().catch(() => ({}));
    const newRole = body.role as OrgRole;

    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    assertOrgAdminRole(membership.role);

    if (!ASSIGNABLE_ROLES.includes(newRole)) {
      throw new AuthzError(400, "invalid_role", "A valid assignable role is required");
    }
    if (memberUserId === ctx.userId) {
      throw new AuthzError(
        400,
        "self_role_change_not_supported",
        "Change your own role via ownership transfer",
      );
    }

    await dbConnect();
    const membersCol = mongoose.connection.collection<OrgMemberRecord>("member");
    const [target, allMembers] = await Promise.all([
      membersCol.findOne({ organizationId: orgId, userId: memberUserId }),
      membersCol.find({ organizationId: orgId }).toArray(),
    ]);
    const orgSpaceId = organizationSpaceId(orgId);
    const currentKeyVersion = await latestProductKeyVersion({
      spaceId: orgSpaceId,
      productId: "drive",
    });

    if (!target) {
      throw new AuthzError(404, "member_not_found", "Member not found");
    }
    const currentRole = normalizeOrgRole(target.role);
    if (currentRole === "owner") {
      throw new AuthzError(
        403,
        "cannot_change_owner_role",
        "Use ownership transfer to change the owner",
      );
    }
    if (currentRole === newRole) {
      return NextResponse.json({ memberUserId, role: newRole, unchanged: true });
    }

    const wasNonGuest = currentRole !== "guest";
    const willBeNonGuest = newRole !== "guest";
    let rotated = false;

    if (wasNonGuest && !willBeNonGuest) {
      // Demotion out of key access → revoke + rotate for remaining members.
      const rotationGrants = normalizeRotationGrants(body.rotationGrants);
      const remainingKeyMembers = allMembers.filter(
        (m) => m.userId !== memberUserId && nonGuest(m),
      );
      const nextKeyVersion = validateRotation({
        targetRole: "member",
        currentMaxKeyVersion: currentKeyVersion,
        remainingKeyMembers,
        rotationGrants,
      });
      rotated = !!nextKeyVersion;

      await mongoSession.withTransaction(async () => {
        await membersCol.updateOne(
          { organizationId: orgId, userId: memberUserId },
          { $set: { role: newRole } },
          { session: mongoSession },
        );
        await revokeMemberProductKeys({
          spaceIds: orgSpaceId,
          memberAccountId: memberUserId,
          productId: "drive",
          rotationReason: "member_removed",
          session: mongoSession,
        });
        if (nextKeyVersion) {
          const remainingIds = remainingKeyMembers.map((m) => m.userId);
          await retireOlderProductKeys({
            spaceId: orgSpaceId,
            productId: "drive",
            memberAccountIds: remainingIds,
            keyVersion: nextKeyVersion,
            rotationReason: "member_removed",
            session: mongoSession,
          });
          for (const grant of rotationGrants) {
            await putMemberProductKey({
              spaceId: orgSpaceId,
              productId: "drive",
              memberAccountId: grant.memberUserId,
              wrappedKey: grant.wrappedSpaceKey,
              keyVersion: grant.keyVersion,
              createdByAccountId: ctx.accountId,
              rotationReason: "member_removed",
              session: mongoSession,
            });
          }
        }
      });
    } else if (!wasNonGuest && willBeNonGuest) {
      // Promotion into key access → requires a fresh wrapped grant (no bump).
      const wrappedSpaceKey =
        typeof body.wrappedSpaceKey === "string" ? body.wrappedSpaceKey.trim() : "";
      const keyVersion = Number(body.keyVersion);
      if (!wrappedSpaceKey || !Number.isInteger(keyVersion) || keyVersion < 1) {
        throw new AuthzError(
          400,
          "space_key_grant_required",
          "Promoting a guest requires a wrapped space key",
        );
      }
      await mongoSession.withTransaction(async () => {
        await membersCol.updateOne(
          { organizationId: orgId, userId: memberUserId },
          { $set: { role: newRole } },
          { session: mongoSession },
        );
        await putMemberProductKey({
          spaceId: orgSpaceId,
          productId: "drive",
          memberAccountId: memberUserId,
          wrappedKey: wrappedSpaceKey,
          keyVersion,
          createdByAccountId: ctx.accountId,
          rotationReason: "member_added",
          session: mongoSession,
        });      });
    } else {
      // Lateral non-guest change — no key implications.
      await membersCol.updateOne(
        { organizationId: orgId, userId: memberUserId },
        { $set: { role: newRole } },
      );
    }

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_ROLE_CHANGED,
      actorUserId: ctx.userId,
      target: { type: "member", id: memberUserId },
      metadata: { from: currentRole, to: newRole, rotated },
    });
    await emitNotification({
      userId: memberUserId,
      type: "role_changed",
      title: "Your role changed",
      body: `Your role is now ${newRole}.`,
      orgId,
      metadata: { from: currentRole, to: newRole },
    });

    return NextResponse.json({ memberUserId, role: newRole, rotated });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to change member role";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await mongoSession.endSession();
  }
}
