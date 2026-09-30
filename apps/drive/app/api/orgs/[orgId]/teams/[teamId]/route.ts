import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgMemberRole,
  assertTeamInOrg,
} from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { beginTeamRetirement, finishTeamRetirement, processRetiringSpace, DriveUploadCommitError } from "@xenode/database/repositories";
import { deleteObjects } from "@/lib/b2/objects";
import mongoose from "mongoose";
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
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    // team:delete is owner/admin.
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });
    await dbConnect();
    const spaceId = teamSpaceId(orgId, teamId);
    await beginTeamRetirement({ orgId, teamId, spaceId });
    const step = await processRetiringSpace({ spaceId, deleteBlobs: deleteObjects });
    const finished = step.complete && await finishTeamRetirement({ orgId, teamId, spaceId });
    if (finished) {
      await emitActivity({
        orgId,
        action: ActivityAction.TEAM_DELETED,
        actorUserId: ctx.userId,
        target: { type: "team", id: teamId },
        metadata: { objectsRemoved: step.deleted },
      });
    }
    return NextResponse.json({ deletedTeamId: teamId, objectsRemoved: step.deleted, cleanupPending: !finished }, { status: finished ? 200 : 202 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    if (error instanceof DriveUploadCommitError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    const message =
      error instanceof Error ? error.message : "Failed to delete team";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
