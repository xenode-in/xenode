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
import { emitNotificationToMany } from "@/lib/notifications/emit";
import type { OrganizationRecord } from "@/lib/orgs/access";
import UserKeyVault from "@/models/UserKeyVault";

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
  expiresAt: Date;
  recipientUserId?: string | null;
  wrappedSpaceKey?: string | null;
  recipientReadyAt?: Date | null;
}

async function orgOwnerAdminIds(orgId: string): Promise<string[]> {
  const admins = await mongoose.connection
    .collection("member")
    .find({ organizationId: orgId, role: { $in: ["owner", "admin"] } })
    .toArray();
  return admins.map((m) => m.userId as string);
}

/**
 * POST /api/orgs/invitations/[invitationId]/claim — a signed-in recipient whose
 * vault now exists signals readiness for a deferred invite. Links their user id
 * onto the invitation and notifies org owners/admins that they can grant the
 * space key. Idempotent: admins are notified only on the first claim.
 *
 * Guest invites need no key — the recipient should accept directly, so this
 * responds with `{ ready: true, needsKey: false }` and does not gate on a vault.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const { invitationId } = await params;

    await dbConnect();
    const invitations =
      mongoose.connection.collection<InvitationRecord>("invitation");
    const invitation = await invitations.findOne({ id: invitationId });
    if (!invitation) {
      throw new AuthzError(404, "invitation_not_found", "Invitation not found");
    }

    const sessionEmail = ctx.session.user.email?.trim().toLowerCase();
    if (!sessionEmail || sessionEmail !== invitation.email) {
      throw new AuthzError(403, "invitation_email_mismatch", "Forbidden");
    }
    if (invitation.status !== "pending") {
      throw new AuthzError(
        409,
        "invitation_not_pending",
        "Invitation is not pending",
      );
    }
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      throw new AuthzError(410, "invitation_expired", "Invitation has expired");
    }

    // Guest → no key ever needed; nothing to claim.
    if (invitation.role === "guest") {
      return NextResponse.json({ ready: true, needsKey: false });
    }

    // Encrypted role already has a wrapped key → recipient can accept now.
    if (invitation.wrappedSpaceKey) {
      return NextResponse.json({ ready: true, needsKey: false });
    }

    // Encrypted role, no key yet → require the recipient's vault to exist so an
    // admin can actually wrap the key for their public key.
    const vault = await UserKeyVault.findOne({ userId: ctx.userId })
      .select("publicKey")
      .lean<{ publicKey?: string }>();
    if (!vault?.publicKey) {
      return NextResponse.json({ ready: false, needsVault: true });
    }

    const alreadyClaimed = !!invitation.recipientReadyAt;
    const now = new Date();
    await invitations.updateOne(
      { id: invitationId, status: "pending" },
      {
        $set: {
          recipientUserId: ctx.userId,
          recipientReadyAt: invitation.recipientReadyAt ?? now,
          updatedAt: now,
        },
      },
    );

    if (!alreadyClaimed) {
      const [organization, adminIds] = await Promise.all([
        mongoose.connection
          .collection<OrganizationRecord>("organization")
          .findOne({ id: invitation.organizationId }),
        orgOwnerAdminIds(invitation.organizationId),
      ]);
      await emitNotificationToMany(adminIds, {
        type: "invite_ready",
        title: "Invitee is ready — grant access",
        body: `${invitation.email} set up their account. Grant their encrypted access.`,
        orgId: invitation.organizationId,
        metadata: {
          invitationId,
          role: invitation.role,
          organizationName: organization?.name ?? null,
        },
      });
    }

    return NextResponse.json({
      ready: false,
      needsKey: true,
      awaitingGrant: true,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to claim invitation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
