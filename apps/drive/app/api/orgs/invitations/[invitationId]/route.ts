import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
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
  getMemberProductKey,
  setMemberProductKeyStatus,
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
  keyVersion?: number | null;
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
  let createdMembership = false;
  let activatedKey = false;

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
      invitation.role !== "guest" &&
      invitation.productKeyReady === true &&
      Number.isInteger(invitation.keyVersion) &&
      Number(invitation.keyVersion) > 0;

    if (action === "reject") {
      if (hasProductKey) {
        await setMemberProductKeyStatus({
          spaceId,
          productId: "drive",
          memberAccountId: ctx.accountId,
          keyVersion: Number(invitation.keyVersion),
          status: "revoked",
          rotationReason: "member_added",
        });
      }
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

    if (hasProductKey) {
      const pendingKey = await getMemberProductKey({
        spaceId,
        productId: "drive",
        memberAccountId: ctx.accountId,
        keyVersion: Number(invitation.keyVersion),
        statuses: ["pending"],
      });
      if (!pendingKey) {
        throw new AuthzError(
          409,
          "product_key_not_pending",
          "Invitation product key is unavailable or already consumed",
        );
      }
    }

    const now = new Date();
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
      { upsert: true },
    );
    createdMembership = memberResult.upsertedCount > 0;

    try {
      if (hasProductKey) {
        const activated = await setMemberProductKeyStatus({
          spaceId,
          productId: "drive",
          memberAccountId: ctx.accountId,
          keyVersion: Number(invitation.keyVersion),
          status: "active",
          rotationReason: "member_added",
        });
        if (!activated) {
          throw new Error("Failed to activate invitation product key");
        }
        activatedKey = true;
      }

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
      );
      if (result.matchedCount !== 1) {
        throw new AuthzError(
          409,
          "invitation_not_pending",
          "Invitation is no longer pending",
        );
      }
    } catch (error) {
      if (activatedKey) {
        await setMemberProductKeyStatus({
          spaceId,
          productId: "drive",
          memberAccountId: ctx.accountId,
          keyVersion: Number(invitation.keyVersion),
          status: "pending",
          rotationReason: "member_added",
        }).catch(() => {});
      }
      if (createdMembership) {
        await mongoose.connection.collection("member").deleteOne({
          organizationId: invitation.organizationId,
          userId: ctx.userId,
        });
      }
      throw error;
    }

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