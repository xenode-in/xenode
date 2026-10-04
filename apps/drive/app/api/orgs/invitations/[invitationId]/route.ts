import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@xenode/database";
import { SpaceProductKey } from "@xenode/database/models";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrganizationsEnabled } from "@/lib/orgs/access";
import { syncSeatsUsed } from "@/lib/orgs/billing/seats";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { emitNotification } from "@/lib/notifications/emit";
import { organizationSpaceId } from "@xenode/spaces/ids";
import {
  fenceSpaceKeyring,
  productKeyVersions,
  setMemberKeyringStatus,
} from "@xenode/spaces/product-keys";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ invitationId: string }>;
}

interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  recipientUserId?: string | null;
  productKeyReady?: boolean;
}

function newPluginId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function serializeInvitation(invitation: InvitationRecord) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    inviterId: invitation.inviterId,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt ?? null,
    acceptedAt: invitation.acceptedAt ?? null,
    rejectedAt: invitation.rejectedAt ?? null,
    recipientUserId: invitation.recipientUserId ?? null,
    spaceKeyReady: !!invitation.productKeyReady,
  };
}

function ensureInvitationCanBeUsed(args: {
  invitation: InvitationRecord;
  userId: string;
  email?: string | null;
}) {
  const userEmail = args.email?.trim().toLowerCase();
  if (!userEmail || userEmail !== args.invitation.email) {
    throw new AuthzError(403, "invitation_email_mismatch", "Forbidden");
  }
  if (
    args.invitation.recipientUserId &&
    args.invitation.recipientUserId !== args.userId
  ) {
    throw new AuthzError(403, "invitation_recipient_mismatch", "Forbidden");
  }
  if (args.invitation.status !== "pending") {
    throw new AuthzError(409, "invitation_not_pending", "Invitation is not pending");
  }
  if (new Date(args.invitation.expiresAt).getTime() <= Date.now()) {
    throw new AuthzError(410, "invitation_expired", "Invitation has expired");
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const { invitationId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === "reject" ? "reject" : "accept";

    await dbConnect();
    const invitations = mongoose.connection.collection<InvitationRecord>(
      "invitation",
    );
    const invitation = await invitations.findOne({ id: invitationId });
    if (!invitation) {
      throw new AuthzError(404, "invitation_not_found", "Invitation not found");
    }

    ensureInvitationCanBeUsed({
      invitation,
      userId: ctx.userId,
      email: ctx.session.user.email,
    });

    const spaceId = organizationSpaceId(invitation.organizationId);
    const hasProductKey =
      invitation.role !== "guest" && invitation.productKeyReady === true;

    if (action === "reject") {
      await setMemberKeyringStatus({
        spaceId,
        productId: "drive",
        memberAccountId: ctx.accountId,
        from: ["pending"],
        status: "revoked",
        rotationReason: "member_added",
      });
      const now = new Date();
      await invitations.updateOne(
        { id: invitation.id, status: "pending" },
        {
          $set: {
            status: "rejected",
            productKeyReady: false,
            rejectedAt: now,
            updatedAt: now,
          },
        },
      );

      await emitActivity({
        orgId: invitation.organizationId,
        action: ActivityAction.MEMBER_INVITE_REJECTED,
        actorUserId: ctx.userId,
        target: { type: "invitation", id: invitation.id },
        metadata: { role: invitation.role },
      });

      return NextResponse.json({
        invitation: serializeInvitation({
          ...invitation,
          status: "rejected",
          productKeyReady: false,
          rejectedAt: now,
          updatedAt: now,
        }),
      });
    }

    if (invitation.role !== "guest" && !hasProductKey) {
      throw new AuthzError(
        409,
        "space_key_grant_required",
        "Encrypted organization access requires a pending product key",
      );
    }

    const now = new Date();
    const createdMembership = await withTransaction(async (session) => {
      if (hasProductKey) {
        // The invitee joins holding every issued version or not at all.
        await fenceSpaceKeyring({ spaceId, session });
        const versions = await productKeyVersions({ spaceId, session });
        const activated = await setMemberKeyringStatus({
          spaceId,
          productId: "drive",
          memberAccountId: ctx.accountId,
          from: ["pending"],
          status: "active",
          rotationReason: "member_added",
          session,
        });
        const held = await SpaceProductKey.countDocuments(
          { spaceId, productId: "drive", memberAccountId: ctx.accountId, status: "active" },
          { session },
        );
        if (!activated || held !== versions.length) {
          throw new AuthzError(
            409,
            "space_key_grant_required",
            "Invitation keys are incomplete; ask an admin to grant access again",
          );
        }
      }
      const memberResult = await mongoose.connection.collection("member").updateOne(
        {
          organizationId: invitation.organizationId,
          userId: ctx.userId,
        },
        {
          $setOnInsert: {
            id: newPluginId("mem"),
            organizationId: invitation.organizationId,
            userId: ctx.userId,
            role: invitation.role,
            createdAt: now,
          },
        },
        { upsert: true, session },
      );
      const result = await invitations.updateOne(
        { id: invitation.id, status: "pending" },
        {
          $set: {
            status: "accepted",
            acceptedAt: now,
            updatedAt: now,
            recipientUserId: ctx.userId,
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
      return memberResult.upsertedCount > 0;
    });

    if (invitation.role !== "guest") {
      await syncSeatsUsed(invitation.organizationId).catch(() => {});
    }

    await emitActivity({
      orgId: invitation.organizationId,
      action: ActivityAction.MEMBER_JOINED,
      actorUserId: ctx.userId,
      target: { type: "member", id: ctx.userId },
      metadata: { role: invitation.role },
    });
    await emitNotification({
      userId: invitation.inviterId,
      type: "invite_accepted",
      title: "Invitation accepted",
      body: "A member accepted your organization invitation.",
      orgId: invitation.organizationId,
      metadata: { invitationId: invitation.id },
    });

    return NextResponse.json({
      invitation: serializeInvitation({
        ...invitation,
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
        recipientUserId: ctx.userId,
      }),
      memberCreated: createdMembership,
      spaceKeyReady: hasProductKey,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to update invitation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}