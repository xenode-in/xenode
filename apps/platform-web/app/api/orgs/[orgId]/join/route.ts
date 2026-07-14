import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { AuthzError, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrganizationsEnabled, type OrganizationRecord } from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import OrgDomain from "@/models/OrgDomain";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * POST /api/orgs/[orgId]/join — domain-based self-join.
 *
 * E2EE constraint: a non-guest member cannot exist without a client-wrapped
 * space key, so domain self-join can only ever admit a GUEST. This is allowed
 * only when the org's `domainJoinPolicy` is "auto", approval is not required,
 * and the caller's verified email domain matches. Member-tier access still
 * requires an admin invitation (with a key grant).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const { orgId } = await params;

    await dbConnect();
    const org = await mongoose.connection
      .collection<OrganizationRecord>("organization")
      .findOne({ id: orgId });
    if (!org || org.deletedAt) {
      throw new AuthzError(404, "organization_not_found", "Organization not found");
    }

    if (org.domainJoinPolicy !== "auto" || org.autoJoinRequiresApproval === true) {
      throw new AuthzError(
        403,
        "domain_self_join_not_allowed",
        "This organization requires an admin invitation to join",
      );
    }

    const email = ctx.session.user.email?.toLowerCase() ?? "";
    const domain = email.includes("@") ? email.split("@")[1] : "";
    if (!domain) {
      throw new AuthzError(400, "email_domain_required", "A verified email domain is required");
    }
    const verified = await OrgDomain.findOne({ orgId, domain, status: "verified" });
    if (!verified) {
      throw new AuthzError(
        403,
        "domain_not_verified_for_org",
        "Your email domain is not verified for this organization",
      );
    }

    const members = mongoose.connection.collection("member");
    const existing = await members.findOne({ organizationId: orgId, userId: ctx.userId });
    if (existing) {
      return NextResponse.json({ orgId, joined: true, alreadyMember: true });
    }

    // Guests hold no space key, so no OrgKeyGrant is created.
    await members.insertOne({
      id: `mem_${randomBytes(12).toString("hex")}`,
      organizationId: orgId,
      userId: ctx.userId,
      role: "guest",
      createdAt: new Date(),
    });

    await emitActivity({
      orgId,
      action: ActivityAction.MEMBER_JOINED,
      actorUserId: ctx.userId,
      target: { type: "member", id: ctx.userId },
      metadata: { role: "guest", via: "domain_auto_join" },
    });

    return NextResponse.json({ orgId, joined: true, role: "guest" }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to join organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
