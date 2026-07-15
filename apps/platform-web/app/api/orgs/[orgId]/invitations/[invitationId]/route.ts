import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { AuthzError, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { emitNotification } from "@/lib/notifications/emit";
import OrgKeyGrant from "@/models/OrgKeyGrant";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; invitationId: string }>;
}

interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  recipientUserId?: string | null;
  wrappedSpaceKey?: string | null;
  keyVersion?: number | null;
  expiresAt?: Date;
}

/**
 * DELETE /api/orgs/[orgId]/invitations/[invitationId] — cancel a pending invite.
 *
 * Owner/admin (invitation:cancel). Marks the invitation "canceled" so
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
      allowed: ["owner", "admin"],
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

/**
 * PATCH /api/orgs/[orgId]/invitations/[invitationId] — grant the deferred space
 * key to a pending invitee whose vault now exists.
 *
 * Owner/admin only (they hold the space key). The client loads the current raw
 * space key, wraps it for the recipient's now-available public key, and PATCHes
 * `{ wrappedSpaceKey, keyVersion }` here. We store it on the invitation; the
 * recipient then accepts via the normal accept endpoint, which installs the
 * member row + OrgKeyGrant from this wrapped key. The server never sees the raw
 * key — this only persists ciphertext.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, invitationId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = await request.json().catch(() => ({}));
    const wrappedSpaceKey =
      typeof body.wrappedSpaceKey === "string" ? body.wrappedSpaceKey.trim() : "";
    const keyVersion = Number(body.keyVersion);
    if (!wrappedSpaceKey) {
      return NextResponse.json(
        { error: "wrappedSpaceKey is required" },
        { status: 400 },
      );
    }
    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      return NextResponse.json(
        { error: "keyVersion must be a positive integer" },
        { status: 400 },
      );
    }

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
        "Only pending invitations can be granted access",
      );
    }
    if (invitation.role === "guest") {
      throw new AuthzError(
        400,
        "guest_needs_no_key",
        "Guest invitations do not require a space key",
      );
    }
    if (
      invitation.expiresAt &&
      new Date(invitation.expiresAt).getTime() <= Date.now()
    ) {
      throw new AuthzError(410, "invitation_expired", "Invitation has expired");
    }

    // The wrapped key must target the org's current key version so acceptance
    // installs a grant consistent with the live space key.
    const currentGrant = await OrgKeyGrant.findOne({ orgId })
      .sort({ keyVersion: -1 })
      .select("keyVersion")
      .lean<{ keyVersion: number }>();
    if (currentGrant && keyVersion !== currentGrant.keyVersion) {
      return NextResponse.json(
        {
          error: "Stale space key version — reload and grant again",
          code: "stale_key_version",
        },
        { status: 409 },
      );
    }

    const now = new Date();
    await invitations.updateOne(
      { id: invitationId, organizationId: orgId, status: "pending" },
      { $set: { wrappedSpaceKey, keyVersion, updatedAt: now } },
    );

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_INVITED,
      actorUserId: ctx.userId,
      target: { type: "invitation", id: invitationId },
      metadata: { role: invitation.role, keyGranted: true },
    });

    if (invitation.recipientUserId) {
      await emitNotification({
        userId: invitation.recipientUserId,
        type: "invite_ready",
        title: "Your encrypted access is ready",
        body: "Open the invitation to join the organization.",
        orgId,
        metadata: { invitationId, role: invitation.role },
      });
    }

    return NextResponse.json({
      invitationId,
      status: "pending",
      spaceKeyReady: true,
      keyVersion,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to grant invitation access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
