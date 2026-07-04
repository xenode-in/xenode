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
import OrgKeyGrant from "@/models/OrgKeyGrant";

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
  wrappedSpaceKey?: string | null;
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
    spaceKeyReady: !!invitation.wrappedSpaceKey,
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

    if (action === "reject") {
      const now = new Date();
      await invitations.updateOne(
        { id: invitation.id, status: "pending" },
        {
          $set: {
            status: "rejected",
            rejectedAt: now,
            updatedAt: now,
          },
        },
      );

      return NextResponse.json({
        invitation: serializeInvitation({
          ...invitation,
          status: "rejected",
          rejectedAt: now,
          updatedAt: now,
        }),
      });
    }

    if (
      invitation.role !== "guest" &&
      (!invitation.wrappedSpaceKey ||
        !Number.isInteger(invitation.keyVersion) ||
        Number(invitation.keyVersion) < 1)
    ) {
      throw new AuthzError(
        409,
        "space_key_grant_required",
        "Encrypted organization access requires a wrapped space key",
      );
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
      if (invitation.wrappedSpaceKey && invitation.keyVersion) {
        await OrgKeyGrant.findOneAndUpdate(
          {
            orgId: invitation.organizationId,
            teamId: null,
            memberUserId: ctx.userId,
            keyVersion: invitation.keyVersion,
          },
          {
            $set: {
              orgId: invitation.organizationId,
              teamId: null,
              memberUserId: ctx.userId,
              wrappedSpaceKey: invitation.wrappedSpaceKey,
              keyVersion: invitation.keyVersion,
              wrappedByUserId: invitation.inviterId,
              createdBy: invitation.inviterId,
              rotationReason: "member_added",
            },
            $unset: { revokedAt: "" },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );
      }

      await invitations.updateOne(
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
    } catch (error) {
      if (createdMembership) {
        await mongoose.connection.collection("member").deleteOne({
          organizationId: invitation.organizationId,
          userId: ctx.userId,
        });
      }
      throw error;
    }

    // A newly accepted non-guest member consumes a seat (best-effort cache).
    if (invitation.role !== "guest") {
      await syncSeatsUsed(invitation.organizationId).catch(() => {});
    }

    return NextResponse.json({
      invitation: serializeInvitation({
        ...invitation,
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
        recipientUserId: ctx.userId,
      }),
      memberCreated: createdMembership,
      spaceKeyReady: !!invitation.wrappedSpaceKey,
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to update invitation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
