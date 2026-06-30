import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import {
  assertMemberInOrg,
  assertOrgAdminRole,
  assertOrgMember,
  assertTeamMember,
} from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";
import OrgKeyGrant from "@/models/OrgKeyGrant";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

type RotationReason = "initial" | "member_added" | "member_removed" | "manual";

function serializeGrant(grant: Record<string, any>) {
  return {
    _id: String(grant._id),
    orgId: grant.orgId,
    teamId: grant.teamId ?? null,
    memberUserId: grant.memberUserId,
    wrappedSpaceKey: grant.wrappedSpaceKey,
    keyVersion: grant.keyVersion,
    wrappedByUserId: grant.wrappedByUserId,
    createdBy: grant.createdBy,
    revokedAt: grant.revokedAt ?? null,
    rotationReason: grant.rotationReason ?? null,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}

function activeGrantScope(teamId: string | null) {
  return teamId
    ? { teamId }
    : {
        $or: [
          { teamId: { $exists: false } },
          { teamId: null },
          { teamId: "" },
        ],
      };
}

function normalizeBody(body: Record<string, unknown>) {
  const memberUserId =
    typeof body.memberUserId === "string" ? body.memberUserId.trim() : "";
  const wrappedSpaceKey =
    typeof body.wrappedSpaceKey === "string" ? body.wrappedSpaceKey.trim() : "";
  const keyVersion = Number(body.keyVersion);
  const teamId = typeof body.teamId === "string" && body.teamId.trim()
    ? body.teamId.trim()
    : null;
  const rotationReason =
    body.rotationReason === "member_added" ||
    body.rotationReason === "member_removed" ||
    body.rotationReason === "manual" ||
    body.rotationReason === "initial"
      ? (body.rotationReason as RotationReason)
      : undefined;

  return {
    memberUserId,
    wrappedSpaceKey,
    keyVersion,
    teamId,
    rotationReason,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const teamId = request.nextUrl.searchParams.get("teamId");

    await assertOrgMember({ userId: ctx.userId, orgId });
    if (teamId) {
      await assertTeamMember({ userId: ctx.userId, orgId, teamId });
    }

    await dbConnect();
    const grants = await OrgKeyGrant.find({
      orgId,
      memberUserId: ctx.userId,
      revokedAt: { $exists: false },
      ...activeGrantScope(teamId),
    })
      .sort({ keyVersion: -1, createdAt: -1 })
      .lean<Array<Record<string, any>>>();

    return NextResponse.json({
      grants: grants.map(serializeGrant),
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to load key grants";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const body = await request.json().catch(() => ({}));
    const {
      memberUserId,
      wrappedSpaceKey,
      keyVersion,
      teamId,
      rotationReason,
    } = normalizeBody(body);

    if (!memberUserId || !wrappedSpaceKey || !Number.isInteger(keyVersion) || keyVersion < 1) {
      return NextResponse.json(
        {
          error:
            "memberUserId, wrappedSpaceKey, and positive integer keyVersion are required",
        },
        { status: 400 },
      );
    }

    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    assertOrgAdminRole(membership.role);
    await assertMemberInOrg({ userId: memberUserId, orgId });
    if (teamId) {
      await assertTeamMember({ userId: memberUserId, orgId, teamId });
    }

    await dbConnect();
    const grant = await OrgKeyGrant.findOneAndUpdate(
      {
        orgId,
        memberUserId,
        keyVersion,
        teamId: teamId ?? null,
      },
      {
        $set: {
          orgId,
          memberUserId,
          wrappedSpaceKey,
          keyVersion,
          wrappedByUserId: ctx.userId,
          createdBy: ctx.userId,
          teamId,
          ...(rotationReason ? { rotationReason } : {}),
        },
        $unset: { revokedAt: "" },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean<Record<string, any>>();

    return NextResponse.json({ grant: serializeGrant(grant) }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to save key grant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
