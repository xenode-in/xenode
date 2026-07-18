import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  assertMemberInOrg,
  assertOrgMember,
  assertOrgMemberRole,
  assertTeamInOrg,
  type UserRecord,
} from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { enforceRateLimit } from "@/lib/ratelimit/limiter";
import { teamSpaceId } from "@xenode/spaces/ids";
import { putMemberProductKey } from "@xenode/spaces/product-keys";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string }>;
}

function userIdLookup(userIds: string[]) {
  const objectIds = userIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  return { $or: [{ id: { $in: userIds } }, { _id: { $in: objectIds } }] };
}

function userAuthId(user: UserRecord): string {
  return user.id || String(user._id ?? "");
}

/**
 * GET /api/orgs/[orgId]/teams/[teamId]/members — list team members with basic
 * profiles. Any org member may view team rosters.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    await assertOrgMember({ userId: ctx.userId, orgId });
    await assertTeamInOrg({ orgId, teamId });

    await dbConnect();
    const teamMembers = await mongoose.connection
      .collection("teamMember")
      .find({ teamId })
      .toArray();
    const userIds = teamMembers.map((tm) => tm.userId as string);
    const users = userIds.length
      ? await mongoose.connection
          .collection<UserRecord>("user")
          .find(userIdLookup(userIds))
          .toArray()
      : [];
    const userById = new Map(users.map((u) => [userAuthId(u), u]));

    return NextResponse.json({
      members: teamMembers.map((tm) => {
        const user = userById.get(tm.userId as string);
        return {
          userId: tm.userId as string,
          user: user
            ? { email: user.email ?? null, name: user.name ?? null, image: user.image ?? null }
            : null,
        };
      }),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to list team members";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/orgs/[orgId]/teams/[teamId]/members — add an existing org member to
 * a team, granting them the (client-wrapped) team space key. Owner/admin.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });
    await assertTeamInOrg({ orgId, teamId });
    await enforceRateLimit({
      key: `team-add:${ctx.userId}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });

    const body = await request.json().catch(() => ({}));
    const memberUserId =
      typeof body.memberUserId === "string" ? body.memberUserId.trim() : "";
    const wrappedTeamKey =
      typeof body.wrappedTeamKey === "string" ? body.wrappedTeamKey.trim() : "";
    const keyVersion = Number(body.keyVersion ?? 1);

    if (!memberUserId || !wrappedTeamKey || !Number.isInteger(keyVersion) || keyVersion < 1) {
      return NextResponse.json(
        {
          error:
            "memberUserId, wrappedTeamKey, and positive integer keyVersion are required",
          code: "team_key_grant_required",
        },
        { status: 400 },
      );
    }

    // Team members must already be non-guest organization members.
    const targetMembership = await assertMemberInOrg({
      userId: memberUserId,
      orgId,
    });
    if (targetMembership.role === "guest") {
      return NextResponse.json(
        { error: "Guests cannot receive team product keys" },
        { status: 403 },
      );
    }

    await dbConnect();
    const existing = await mongoose.connection
      .collection("teamMember")
      .findOne({ teamId, userId: memberUserId });
    if (existing) {
      return NextResponse.json(
        { error: "User is already a member of this team" },
        { status: 409 },
      );
    }

    const now = new Date();
    await mongoose.connection.collection("teamMember").insertOne({
      id: `tmem_${randomBytes(12).toString("hex")}`,
      teamId,
      userId: memberUserId,
      createdAt: now,
    });

    try {
      await putMemberProductKey({
        spaceId: teamSpaceId(orgId, teamId),
        productId: "drive",
        memberAccountId: memberUserId,
        wrappedKey: wrappedTeamKey,
        keyVersion,
        createdByAccountId: ctx.accountId,
        rotationReason: "member_added",
      });
    } catch (error) {
      await mongoose.connection
        .collection("teamMember")
        .deleteOne({ teamId, userId: memberUserId });
      throw error;
    }

    await emitActivity({
      orgId,
      action: ActivityAction.TEAM_MEMBER_ADDED,
      actorUserId: ctx.userId,
      target: { type: "team", id: teamId },
      metadata: { memberUserId },
    });

    return NextResponse.json({ added: true, teamId, memberUserId }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to add team member";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
