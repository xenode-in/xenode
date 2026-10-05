import mongoose, { type ClientSession } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@xenode/database";
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
  fenceSpaceKeyring,
  parseKeyringGrants,
  productKeyVersions,
  putMemberKeyring,
  putMemberProductKey,
  revokeMemberProductKeys,
} from "@xenode/spaces/product-keys";
import { SpaceProductKey } from "@xenode/database/models";

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

/**
 * Add the rotated version for every remaining keyholder. Older versions stay
 * active for them: content keeps its original `spaceKeyVersion`. Invitees
 * never received the new version, so their pending grants are revoked and the
 * invitation waits for an admin to grant the full keyring again.
 */
async function storeRotation(args: {
  orgId: string;
  spaceId: string;
  actorAccountId: string;
  rotationGrants: ReturnType<typeof normalizeRotationGrants>;
  session: ClientSession;
  now: Date;
}) {
  await SpaceProductKey.updateMany(
    { spaceId: args.spaceId, productId: "drive", status: "pending" },
    { $set: { status: "revoked", rotationReason: "member_removed" } },
    { session: args.session },
  );
  await mongoose.connection.collection("invitation").updateMany(
    { organizationId: args.orgId, status: "pending", productKeyReady: true },
    { $set: { productKeyReady: false, updatedAt: args.now } },
    { session: args.session },
  );
  for (const grant of args.rotationGrants) {
    await putMemberProductKey({
      spaceId: args.spaceId,
      productId: "drive",
      memberAccountId: grant.memberUserId,
      wrappedKey: grant.wrappedSpaceKey,
      keyVersion: grant.keyVersion,
      createdByAccountId: args.actorAccountId,
      rotationReason: "member_removed",
      session: args.session,
    });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
    const orgSpaceId = organizationSpaceId(orgId);
    const affectedSpaces = await Space.find({ organizationId: orgId })
      .select("_id")
      .lean<Array<{ _id: string }>>();
    const affectedSpaceIds = affectedSpaces.map((space) => space._id);
    const now = new Date();
    const { targetMember, targetRole, remainingMembers, nextKeyVersion } =
      await withTransaction(async (mongoSession) => {
      // Validate against the membership and key versions this commit sees.
      await fenceSpaceKeyring({ spaceId: orgSpaceId, session: mongoSession });
      const allMembers = await membersCollection
        .find({ organizationId: orgId }, { session: mongoSession })
        .toArray();
      const targetMember = allMembers.find((member) => member.userId === memberUserId);
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
      const versions = await productKeyVersions({ spaceId: orgSpaceId, session: mongoSession });
      const nextKeyVersion = validateRotation({
        targetRole,
        currentMaxKeyVersion: versions.at(-1) ?? 0,
        remainingKeyMembers: remainingMembers.filter(nonGuest),
        rotationGrants,
      });

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
        await storeRotation({
          orgId,
          spaceId: orgSpaceId,
          actorAccountId: ctx.accountId,
          rotationGrants,
          session: mongoSession,
          now,
        });
      }
      return { targetMember, targetRole, remainingMembers, nextKeyVersion };
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
  }
}

const ASSIGNABLE_ROLES: OrgRole[] = ["admin", "member", "guest"];

/**
 * PATCH /api/orgs/[orgId]/members/[memberUserId] — change a member's role.
 *
 * Owner/admin only. Owner role is managed via ownership transfer, not here.
 * E2EE: rotation is driven by crossing the guest boundary —
 *   - non-guest → guest: revoke their grants + rotate the space key (rotationGrants required)
 *   - guest → non-guest: install grants for every issued version (`grants`, no bump)
 *   - admin ↔ member: no key change.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
    const orgSpaceId = organizationSpaceId(orgId);
    const now = new Date();
    const change = await withTransaction(async (session) => {
      await fenceSpaceKeyring({ spaceId: orgSpaceId, session });
      const allMembers = await membersCol
        .find({ organizationId: orgId }, { session })
        .toArray();
      const target = allMembers.find((member) => member.userId === memberUserId);
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
      if (currentRole === newRole) return { currentRole, rotated: false, unchanged: true };

      const wasNonGuest = currentRole !== "guest";
      const willBeNonGuest = newRole !== "guest";
      const setRole = () => membersCol.updateOne(
        { organizationId: orgId, userId: memberUserId },
        { $set: { role: newRole } },
        { session },
      );

      if (wasNonGuest && !willBeNonGuest) {
        // Demotion out of key access → revoke + rotate for remaining members.
        const rotationGrants = normalizeRotationGrants(body.rotationGrants);
        const versions = await productKeyVersions({ spaceId: orgSpaceId, session });
        const nextKeyVersion = validateRotation({
          targetRole: "member",
          currentMaxKeyVersion: versions.at(-1) ?? 0,
          remainingKeyMembers: allMembers.filter(
            (member) => member.userId !== memberUserId && nonGuest(member),
          ),
          rotationGrants,
        });
        await setRole();
        // Guests hold no workspace keys: drop team memberships and every
        // grant in the organization's Spaces, as removal does.
        const teams = await mongoose.connection
          .collection<TeamRecord>("team")
          .find({ organizationId: orgId }, { session })
          .project<{ id: string }>({ id: 1 })
          .toArray();
        await mongoose.connection.collection("teamMember").deleteMany(
          { userId: memberUserId, teamId: { $in: teams.map((team) => team.id) } },
          { session },
        );
        const orgSpaces = await Space.find({ organizationId: orgId })
          .select("_id")
          .session(session)
          .lean<Array<{ _id: string }>>();
        await revokeMemberProductKeys({
          spaceIds: orgSpaces.map((space) => space._id),
          memberAccountId: memberUserId,
          productIds: ["accounts", "drive", "photos", "mobile", "office-editor"],
          rotationReason: "member_removed",
          session,
        });
        if (nextKeyVersion) {
          await storeRotation({
            orgId,
            spaceId: orgSpaceId,
            actorAccountId: ctx.accountId,
            rotationGrants,
            session,
            now,
          });
        }
        return { currentRole, rotated: !!nextKeyVersion, unchanged: false };
      }
      if (!wasNonGuest && willBeNonGuest) {
        // Promotion into key access → every issued version, no bump.
        const grants = parseKeyringGrants(
          body.grants,
          await productKeyVersions({ spaceId: orgSpaceId, session }),
        );
        await setRole();
        await putMemberKeyring({
          spaceId: orgSpaceId,
          productId: "drive",
          memberAccountId: memberUserId,
          grants,
          createdByAccountId: ctx.accountId,
          rotationReason: "member_added",
          session,
        });
        return { currentRole, rotated: false, unchanged: false };
      }
      // Lateral non-guest change — no key implications.
      await setRole();
      return { currentRole, rotated: false, unchanged: false };
    });
    if (change.unchanged) {
      return NextResponse.json({ memberUserId, role: newRole, unchanged: true });
    }
    const { currentRole, rotated } = change;

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
  }
}
