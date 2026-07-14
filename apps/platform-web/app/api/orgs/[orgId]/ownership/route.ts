import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { normalizeOrgRole } from "@/lib/auth/organization";
import dbConnect from "@/lib/mongodb";
import {
  assertMemberInOrg,
  assertOrgMember,
  type OrgMemberRecord,
} from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * PATCH /api/orgs/[orgId]/ownership — transfer ownership to another member.
 *
 * Owner-only. Promotes the target to `owner` and demotes the acting owner to
 * `admin` in one transaction. Never leaves the org ownerless. No key rotation:
 * both parties remain members and keep their existing space-key grants.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const mongoSession = await mongoose.startSession();
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;

    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    if (membership.role !== "owner") {
      throw new AuthzError(403, "organization_owner_required", "Forbidden");
    }

    const body = await request.json().catch(() => ({}));
    const newOwnerUserId =
      typeof body.newOwnerUserId === "string" ? body.newOwnerUserId.trim() : "";
    if (!newOwnerUserId) {
      return NextResponse.json(
        { error: "newOwnerUserId is required" },
        { status: 400 },
      );
    }
    if (newOwnerUserId === ctx.userId) {
      return NextResponse.json(
        { error: "You are already the owner" },
        { status: 400 },
      );
    }

    // Target must already be a member of the org.
    await assertMemberInOrg({ userId: newOwnerUserId, orgId });

    await dbConnect();
    const members = mongoose.connection.collection<OrgMemberRecord>("member");

    await mongoSession.withTransaction(async () => {
      await members.updateOne(
        { organizationId: orgId, userId: newOwnerUserId },
        { $set: { role: "owner" } },
        { session: mongoSession },
      );
      await members.updateOne(
        { organizationId: orgId, userId: ctx.userId },
        { $set: { role: "admin" } },
        { session: mongoSession },
      );
    });

    await emitActivity({
      orgId,
      action: ActivityAction.ORG_OWNERSHIP_TRANSFERRED,
      actorUserId: ctx.userId,
      target: { type: "member", id: newOwnerUserId },
    });

    return NextResponse.json({
      newOwnerUserId,
      previousOwnerUserId: ctx.userId,
      previousOwnerRole: normalizeOrgRole("admin"),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to transfer ownership";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await mongoSession.endSession();
  }
}
