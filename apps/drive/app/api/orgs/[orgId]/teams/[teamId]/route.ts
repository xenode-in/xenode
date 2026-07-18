import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgMemberRole,
  assertTeamInOrg,
} from "@/lib/orgs/access";
import { teamObjectClause } from "@/lib/orgs/storage";
import { decrementOrgStorage } from "@/lib/orgs/billing/orgUsage";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import StorageObject from "@/models/StorageObject";
import { Space, SpaceProductKey } from "@xenode/database/models";
import { teamSpaceId } from "@xenode/spaces/ids";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    // Team rename is restricted to organization owners and admins.
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });
    await assertTeamInOrg({ orgId, teamId });

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) {
      return NextResponse.json({ error: "Team name is required" }, { status: 400 });
    }

    await dbConnect();
    await mongoose.connection
      .collection("team")
      .updateOne({ id: teamId, organizationId: orgId }, {
        $set: { name, updatedAt: new Date() },
      });

    return NextResponse.json({ team: { id: teamId, name } });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to update team";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const mongoSession = await mongoose.startSession();
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    // team:delete is owner/admin.
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });
    await assertTeamInOrg({ orgId, teamId });

    await dbConnect();

    // Sum the team drive's bytes so we can roll them back off OrgUsage.
    const agg = await StorageObject.aggregate([
      { $match: teamObjectClause(orgId, teamId) },
      { $group: { _id: null, bytes: { $sum: "$size" }, count: { $sum: 1 } } },
    ]);
    const bytes = agg[0]?.bytes ?? 0;
    const count = agg[0]?.count ?? 0;

    await mongoSession.withTransaction(async () => {
      await StorageObject.deleteMany(teamObjectClause(orgId, teamId), {
        session: mongoSession,
      });
      const spaceId = teamSpaceId(orgId, teamId);
      await SpaceProductKey.deleteMany({ spaceId }, { session: mongoSession });
      await Space.deleteOne({ _id: spaceId }, { session: mongoSession });
      await mongoose.connection
        .collection("teamMember")
        .deleteMany({ teamId }, { session: mongoSession });
      // Product key envelopes were revoked with the team Space above.
      await mongoose.connection
        .collection("team")
        .deleteOne({ id: teamId, organizationId: orgId }, { session: mongoSession });
    });

    // Roll usage back outside the transaction (OrgUsage is a separate concern).
    if (bytes > 0 || count > 0) {
      await decrementOrgStorage(orgId, bytes, count).catch(() => {});
    }

    await emitActivity({
      orgId,
      action: ActivityAction.TEAM_DELETED,
      actorUserId: ctx.userId,
      target: { type: "team", id: teamId },
      metadata: { objectsRemoved: count },
    });

    return NextResponse.json({ deletedTeamId: teamId, objectsRemoved: count });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to delete team";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await mongoSession.endSession();
  }
}
