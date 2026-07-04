import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgMember,
  assertOrgMemberRole,
  type TeamRecord,
} from "@/lib/orgs/access";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { getBucketForWorkspace } from "@/lib/storage/workspaceBucket";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import Bucket from "@/models/Bucket";
import OrgKeyGrant from "@/models/OrgKeyGrant";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

function newPluginId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMember({ userId: ctx.userId, orgId });

    await dbConnect();
    const teams = await mongoose.connection
      .collection<TeamRecord>("team")
      .find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .toArray();

    const teamIds = teams.map((team) => team.id);
    const memberships = teamIds.length
      ? await mongoose.connection
          .collection("teamMember")
          .find({ teamId: { $in: teamIds } })
          .toArray()
      : [];

    const countByTeam = new Map<string, number>();
    const myTeams = new Set<string>();
    for (const tm of memberships) {
      const tid = tm.teamId as string;
      countByTeam.set(tid, (countByTeam.get(tid) ?? 0) + 1);
      if (tm.userId === ctx.userId) myTeams.add(tid);
    }

    return NextResponse.json({
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        createdAt: team.createdAt ?? null,
        memberCount: countByTeam.get(team.id) ?? 0,
        isMember: myTeams.has(team.id),
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to list teams";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    // team:create is owner/admin in the org access-control matrix.
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = await request.json().catch(() => ({}));
    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "Team name is required" },
        { status: 400 },
      );
    }
    const ownerWrappedTeamKey =
      typeof body.ownerWrappedTeamKey === "string"
        ? body.ownerWrappedTeamKey.trim()
        : "";
    const keyVersion = Number.isInteger(Number(body.keyVersion))
      ? Number(body.keyVersion)
      : 1;

    await dbConnect();
    const now = new Date();
    const team: TeamRecord = {
      id: newPluginId("team"),
      name,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await mongoose.connection.collection("team").insertOne(team);
      await mongoose.connection.collection("teamMember").insertOne({
        id: newPluginId("tmem"),
        teamId: team.id,
        userId: ctx.userId,
        createdAt: now,
      });
      if (ownerWrappedTeamKey) {
        await OrgKeyGrant.create({
          orgId,
          teamId: team.id,
          memberUserId: ctx.userId,
          wrappedSpaceKey: ownerWrappedTeamKey,
          keyVersion,
          wrappedByUserId: ctx.userId,
          createdBy: ctx.userId,
          rotationReason: "initial",
        });
      }
      await Bucket.create({
        userId: orgStorageOwnerId(orgId),
        ownerScope: "team",
        orgId,
        teamId: team.id,
        createdBy: ctx.userId,
        name: "workspace",
        b2BucketId: getBucketForWorkspace("ORGANIZATION"),
      });
    } catch (error) {
      await mongoose.connection.collection("team").deleteOne({ id: team.id });
      await mongoose.connection
        .collection("teamMember")
        .deleteMany({ teamId: team.id });
      await Bucket.deleteMany({ orgId, teamId: team.id });
      await OrgKeyGrant.deleteMany({ orgId, teamId: team.id });
      throw error;
    }

    await emitActivity({
      orgId,
      action: ActivityAction.TEAM_CREATED,
      actorUserId: ctx.userId,
      target: { type: "team", id: team.id },
    });

    return NextResponse.json(
      {
        team: {
          id: team.id,
          name: team.name,
          createdAt: team.createdAt,
          memberCount: 1,
          isMember: true,
        },
        teamKeyReady: !!ownerWrappedTeamKey,
      },
      { status: 201 },
    );
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to create team";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
