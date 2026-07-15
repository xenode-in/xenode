import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  assertOrganizationsEnabled,
  type OrganizationRecord,
} from "@/lib/orgs/access";

export const dynamic = "force-dynamic";

interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt?: Date;
  recipientUserId?: string | null;
  productKeyReady?: boolean;
  recipientReadyAt?: Date | null;
}

function serializeInvitation(
  invitation: InvitationRecord,
  organization?: OrganizationRecord,
) {
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
    spaceKeyReady: !!invitation.productKeyReady,
    awaitingRecipientKey:
      invitation.role !== "guest" && !invitation.productKeyReady,
    recipientReadyAt: invitation.recipientReadyAt ?? null,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug ?? null,
          logo: organization.logo ?? null,
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const email = ctx.session.user.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ invitations: [] });
    }

    await dbConnect();
    const invitations = await mongoose.connection
      .collection<InvitationRecord>("invitation")
      .find({ email, status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();
    const orgIds = invitations.map((invitation) => invitation.organizationId);
    const organizations = orgIds.length
      ? await mongoose.connection
          .collection<OrganizationRecord>("organization")
          .find({ id: { $in: orgIds } })
          .toArray()
      : [];
    const orgById = new Map(organizations.map((org) => [org.id, org]));

    return NextResponse.json({
      invitations: invitations.map((invitation) =>
        serializeInvitation(invitation, orgById.get(invitation.organizationId)),
      ),
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
