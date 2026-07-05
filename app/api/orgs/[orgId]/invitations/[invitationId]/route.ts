import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { AuthzError, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; invitationId: string }>;
}

interface InvitationRecord {
  id: string;
  organizationId: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
}

/**
 * DELETE /api/orgs/[orgId]/invitations/[invitationId] — cancel a pending invite.
 *
 * Owner/admin/manager (invitation:cancel). Marks the invitation "canceled" so
 * its wrapped space key is never delivered. No key rotation is needed: a pending
 * invite holds a wrapped key but no live grant has been issued.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, invitationId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin", "manager"],
    });

    await dbConnect();
    const invitations =
      mongoose.connection.collection<InvitationRecord>("invitation");
    const invitation = await invitations.findOne({
      id: invitationId,
      organizationId: orgId,
    });
    if (!invitation) {
      throw new AuthzError(404, "invitation_not_found", "Invitation not found");
    }
    if (invitation.status !== "pending") {
      throw new AuthzError(
        409,
        "invitation_not_pending",
        "Only pending invitations can be cancelled",
      );
    }

    await invitations.updateOne(
      { id: invitationId, organizationId: orgId, status: "pending" },
      { $set: { status: "canceled", updatedAt: new Date() } },
    );

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_INVITE_CANCELLED,
      actorUserId: ctx.userId,
      target: { type: "invitation", id: invitationId },
      metadata: { role: invitation.role },
    });

    return NextResponse.json({ invitationId, status: "canceled" });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to cancel invitation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
