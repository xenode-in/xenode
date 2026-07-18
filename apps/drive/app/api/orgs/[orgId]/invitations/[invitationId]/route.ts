import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
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
  latestProductKeyVersion,
  putMemberProductKey,
  setMemberProductKeyStatus,
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
  keyVersion?: number | null;
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
  if (
    !invitation.productKeyReady ||
    !invitation.recipientUserId ||
    !Number.isInteger(invitation.keyVersion) ||
    Number(invitation.keyVersion) < 1
  ) {
    return;
  }
  await setMemberProductKeyStatus({
    spaceId: organizationSpaceId(invitation.organizationId),
    productId: "drive",
    memberAccountId: invitation.recipientUserId,
    keyVersion: Number(invitation.keyVersion),
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
 * Stores a pending RSA-wrapped Drive key for an invitee whose account and vault
 * now exist. Ciphertext lives only in SpaceProductKey; the invitation stores
 * readiness and version metadata.
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
    const memberAccountId =
      typeof body.memberAccountId === "string" ? body.memberAccountId.trim() : "";
    const keyVersion = Number(body.keyVersion);
    if (!wrappedSpaceKey || !memberAccountId) {
      return NextResponse.json(
        { error: "wrappedSpaceKey and memberAccountId are required" },
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
    const currentKeyVersion = await latestProductKeyVersion({
      spaceId,
      productId: "drive",
    });
    if (currentKeyVersion > 0 && keyVersion !== currentKeyVersion) {
      return NextResponse.json(
        {
          error: "Stale space key version — reload and grant again",
          code: "stale_key_version",
        },
        { status: 409 },
      );
    }

    await putMemberProductKey({
      spaceId,
      productId: "drive",
      memberAccountId,
      wrappedKey: wrappedSpaceKey,
      keyVersion,
      createdByAccountId: ctx.accountId,
      rotationReason: "member_added",
      status: "pending",
    });

    const now = new Date();
    const result = await invitations.updateOne(
      { id: invitationId, organizationId: orgId, status: "pending" },
      {
        $set: {
          recipientUserId: memberAccountId,
          productKeyReady: true,
          keyVersion,
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      await setMemberProductKeyStatus({
        spaceId,
        productId: "drive",
        memberAccountId,
        keyVersion,
        status: "revoked",
        rotationReason: "member_added",
      });
      throw new AuthzError(
        409,
        "invitation_not_pending",
        "Invitation is no longer pending",
      );
    }

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
      keyVersion,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to grant invitation access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}