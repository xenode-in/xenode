import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@xenode/database";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { emitNotification } from "@/lib/notifications/emit";
import { organizationSpaceId } from "@xenode/spaces/ids";
import {
  fenceSpaceKeyring,
  parseKeyringGrants,
  productKeyVersions,
  putMemberKeyring,
  setMemberKeyringStatus,
} from "@xenode/spaces/product-keys";

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
  productKeyReady?: boolean;
  expiresAt?: Date;
}

interface UserRecord {
  _id?: unknown;
  id?: string;
  email?: string | null;
}

function userIdLookup(userId: string) {
  const clauses: Array<Record<string, unknown>> = [{ id: userId }];
  if (mongoose.Types.ObjectId.isValid(userId)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(userId) });
  }
  return { $or: clauses };
}

async function revokePendingInvitationKey(invitation: InvitationRecord) {
  if (!invitation.recipientUserId) return;
  await setMemberKeyringStatus({
    spaceId: organizationSpaceId(invitation.organizationId),
    productId: "drive",
    memberAccountId: invitation.recipientUserId,
    from: ["pending"],
    status: "revoked",
    rotationReason: "member_added",
  });
}

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

    await revokePendingInvitationKey(invitation);
    await invitations.updateOne(
      { id: invitationId, organizationId: orgId, status: "pending" },
      {
        $set: {
          status: "canceled",
          productKeyReady: false,
          updatedAt: new Date(),
        },
      },
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
 * Stores pending RSA-wrapped Drive keys (`grants`, one per issued version) for
 * an invitee whose account and vault now exist. Ciphertext lives only in
 * SpaceProductKey; the invitation stores readiness.
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
    const memberAccountId =
      typeof body.memberAccountId === "string" ? body.memberAccountId.trim() : "";
    if (!memberAccountId) {
      return NextResponse.json(
        { error: "memberAccountId is required" },
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
    if (
      invitation.recipientUserId &&
      invitation.recipientUserId !== memberAccountId
    ) {
      throw new AuthzError(403, "invitation_recipient_mismatch", "Forbidden");
    }

    const recipient = await mongoose.connection
      .collection<UserRecord>("user")
      .findOne(userIdLookup(memberAccountId));
    if (!recipient || recipient.email?.trim().toLowerCase() !== invitation.email) {
      throw new AuthzError(403, "invitation_email_mismatch", "Forbidden");
    }

    const spaceId = organizationSpaceId(orgId);
    await withTransaction(async (session) => {
      // A stale client (missing a version issued since it loaded) gets 409.
      await fenceSpaceKeyring({ spaceId, session });
      const grants = parseKeyringGrants(
        body.grants,
        await productKeyVersions({ spaceId, session }),
      );
      const result = await invitations.updateOne(
        { id: invitationId, organizationId: orgId, status: "pending" },
        {
          $set: {
            recipientUserId: memberAccountId,
            productKeyReady: true,
            updatedAt: new Date(),
          },
        },
        { session },
      );
      if (result.matchedCount !== 1) {
        throw new AuthzError(
          409,
          "invitation_not_pending",
          "Invitation is no longer pending",
        );
      }
      await putMemberKeyring({
        spaceId,
        productId: "drive",
        memberAccountId,
        grants,
        createdByAccountId: ctx.accountId,
        rotationReason: "member_added",
        status: "pending",
        session,
      });
    });

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_INVITED,
      actorUserId: ctx.userId,
      target: { type: "invitation", id: invitationId },
      metadata: { role: invitation.role, keyGranted: true },
    });
    await emitNotification({
      userId: memberAccountId,
      type: "invite_ready",
      title: "Your encrypted access is ready",
      body: "Open the invitation to join the organization.",
      orgId,
      metadata: { invitationId, role: invitation.role },
    });

    return NextResponse.json({
      invitationId,
      status: "pending",
      spaceKeyReady: true,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to grant invitation access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}