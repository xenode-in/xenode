import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { notifyOrganizationInvitation } from "@/lib/email/notifications";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgMember,
  assertOrgMemberRole,
  type OrganizationRecord,
  type UserRecord,
} from "@/lib/orgs/access";
import { assertSeatHeadroomForInvite } from "@/lib/orgs/billing/seats";
import { findLastDeparture } from "@/lib/orgs/membershipHistory";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { emitNotification } from "@/lib/notifications/emit";
import { enforceRateLimit } from "@/lib/ratelimit/limiter";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

type InvitationRole = "admin" | "member" | "guest";

interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: InvitationRole;
  status: "pending" | "accepted" | "rejected" | "canceled";
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt?: Date;
  recipientUserId?: string | null;
  wrappedSpaceKey?: string | null;
  keyVersion?: number | null;
  recipientReadyAt?: Date | null;
  previouslyMember?: boolean;
  lastRemovedAt?: Date | null;
}

const INVITABLE_ROLES: InvitationRole[] = ["admin", "member", "guest"];

function newPluginId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeRole(value: unknown): InvitationRole | null {
  return INVITABLE_ROLES.includes(value as InvitationRole)
    ? (value as InvitationRole)
    : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function userAuthId(user?: UserRecord | null): string | null {
  if (!user) return null;
  return user.id || String(user._id ?? "") || null;
}

function userIdLookup(userId: string) {
  const clauses: Array<Record<string, unknown>> = [{ id: userId }];
  if (mongoose.Types.ObjectId.isValid(userId)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(userId) });
  }
  return { $or: clauses };
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
    recipientUserId: invitation.recipientUserId ?? null,
    spaceKeyReady: !!invitation.wrappedSpaceKey,
    awaitingRecipientKey:
      invitation.role !== "guest" && !invitation.wrappedSpaceKey,
    recipientReadyAt: invitation.recipientReadyAt ?? null,
    previouslyMember: !!invitation.previouslyMember,
    lastRemovedAt: invitation.lastRemovedAt ?? null,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;

    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    await dbConnect();
    const invitations = await mongoose.connection
      .collection<InvitationRecord>("invitation")
      .find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      invitations: invitations.map(serializeInvitation),
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to list invitations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const role = normalizeRole(body.role);
    const recipientUserId = normalizeOptionalString(body.recipientUserId);
    const wrappedSpaceKey = normalizeOptionalString(body.wrappedSpaceKey);
    const keyVersion = Number(body.keyVersion ?? 1);

    if (!email || !role) {
      return NextResponse.json(
        { error: "email and valid role are required" },
        { status: 400 },
      );
    }
    // A wrapped space key may be supplied when the recipient already has a vault
    // (immediate encrypted access). When it is absent for a non-guest role, this
    // is a DEFERRED invite: the recipient has no public key yet (no account or no
    // vault), so the key is granted later once they onboard. Guests never carry a
    // key. Only validate keyVersion when a wrapped key is actually present.
    if (wrappedSpaceKey && (!Number.isInteger(keyVersion) || keyVersion < 1)) {
      return NextResponse.json(
        {
          error: "A positive integer keyVersion is required with a wrapped space key",
          code: "space_key_grant_required",
        },
        { status: 400 },
      );
    }

    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    if (membership.role !== "owner" && membership.role !== "admin") {
      throw new AuthzError(403, "organization_admin_required", "Forbidden");
    }

    await enforceRateLimit({
      key: `org-invite:${ctx.userId}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });

    // Non-guest members consume a billing seat — block over-provisioning.
    // Guests are free and skip the seat check.
    if (role !== "guest") {
      await assertSeatHeadroomForInvite(orgId);
    }

    await dbConnect();
    const [organization, existingInvite, recipient] = await Promise.all([
        mongoose.connection
          .collection<OrganizationRecord>("organization")
          .findOne({ id: orgId }),
        mongoose.connection.collection<InvitationRecord>("invitation").findOne({
          organizationId: orgId,
          email,
          status: "pending",
        }),
        recipientUserId
          ? mongoose.connection
              .collection<UserRecord>("user")
              .findOne(userIdLookup(recipientUserId))
          : mongoose.connection
              .collection<UserRecord>("user")
              .findOne({ email }),
      ]);
    const resolvedRecipientUserId = recipientUserId ?? userAuthId(recipient);
    const existingMember = resolvedRecipientUserId
      ? await mongoose.connection.collection("member").findOne({
          organizationId: orgId,
          userId: resolvedRecipientUserId,
        })
      : null;

    if (!organization) {
      throw new AuthzError(404, "organization_not_found", "Organization not found");
    }
    // A wrapped key must have a resolvable recipient to grant it to. Deferred
    // invites (no wrapped key) are allowed with a null recipient — the account
    // may not exist yet.
    if (wrappedSpaceKey && !resolvedRecipientUserId) {
      return NextResponse.json(
        {
          error:
            "A wrapped space key requires an existing recipient account",
          code: "recipient_user_required",
        },
        { status: 400 },
      );
    }
    if (recipientUserId && (!recipient || recipient.email?.toLowerCase() !== email)) {
      return NextResponse.json(
        { error: "Recipient user does not match invitation email" },
        { status: 400 },
      );
    }
    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of this organization" },
        { status: 409 },
      );
    }
    if (existingInvite) {
      return NextResponse.json(
        { error: "A pending invitation already exists for this email" },
        { status: 409 },
      );
    }

    const priorDeparture = await findLastDeparture(orgId, email);

    const now = new Date();
    const invitation: InvitationRecord = {
      id: newPluginId("inv"),
      organizationId: orgId,
      email,
      role,
      status: "pending",
      inviterId: ctx.userId,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      recipientUserId: resolvedRecipientUserId,
      wrappedSpaceKey,
      keyVersion: wrappedSpaceKey ? keyVersion : null,
      recipientReadyAt: null,
      previouslyMember: !!priorDeparture,
      lastRemovedAt: priorDeparture?.removedAt ?? null,
    };

    await mongoose.connection
      .collection<InvitationRecord>("invitation")
      .insertOne(invitation);

    await notifyOrganizationInvitation({
      to: email,
      inviterName: ctx.session.user.name ?? ctx.session.user.email ?? "A Xenode user",
      organizationName: organization.name,
      invitationId: invitation.id,
      role,
      expiresAt: invitation.expiresAt,
    });

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_INVITED,
      actorUserId: ctx.userId,
      target: { type: "invitation", id: invitation.id },
      metadata: { role },
    });
    if (resolvedRecipientUserId) {
      await emitNotification({
        userId: resolvedRecipientUserId,
        type: "invite_received",
        title: `You've been invited to ${organization.name}`,
        body: `Role: ${role}. Open Organizations to accept.`,
        orgId,
        metadata: { invitationId: invitation.id, role },
      });
    }

    return NextResponse.json(
      { invitation: serializeInvitation(invitation) },
      { status: 201 },
    );
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to create invitation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
