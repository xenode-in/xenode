import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import type { OrganizationRecord } from "@/lib/orgs/access";

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
  wrappedSpaceKey?: string | null;
}

/** Mask an email for display: `santhosh@acme.com` → `s•••@acme.com`. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/**
 * GET /api/orgs/invitations/[invitationId]/public — minimal, unauthenticated
 * summary for the invite landing page, so a person with no account can see what
 * they're joining before signing up. Guarded only by the opaque invitation id;
 * returns no members, keys, or full email.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { invitationId } = await params;
    await dbConnect();
    const invitation = await mongoose.connection
      .collection<InvitationRecord>("invitation")
      .findOne({ id: invitationId });

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    const organization = await mongoose.connection
      .collection<OrganizationRecord>("organization")
      .findOne({ id: invitation.organizationId });

    const expired = new Date(invitation.expiresAt).getTime() <= Date.now();

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        organizationName: organization?.name ?? "an organization",
        organizationLogo: organization?.logo ?? null,
        role: invitation.role,
        status: expired ? "expired" : invitation.status,
        expiresAt: invitation.expiresAt,
        // The invitation id is a secret token delivered only to the invitee's
        // inbox, so returning the target email (to prefill signup) is safe and
        // expected — same as GitHub/Slack invite links.
        email: invitation.email,
        emailHint: maskEmail(invitation.email),
        spaceKeyReady: !!invitation.wrappedSpaceKey,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load invitation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
