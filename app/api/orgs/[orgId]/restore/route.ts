import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { normalizeOrgRole } from "@/lib/auth/organization";
import dbConnect from "@/lib/mongodb";
import {
  assertOrganizationsEnabled,
  type OrgMemberRecord,
  type OrganizationRecord,
} from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * POST /api/orgs/[orgId]/restore — undo a soft-delete within the recovery window.
 *
 * Cannot use `assertOrgMember` (it rejects soft-deleted orgs), so it loads the
 * org + membership directly and requires the caller to be the owner.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const { orgId } = await params;

    await dbConnect();
    const organizations =
      mongoose.connection.collection<OrganizationRecord>("organization");
    const org = await organizations.findOne({ id: orgId });
    if (!org) {
      throw new AuthzError(404, "organization_not_found", "Organization not found");
    }
    if (!org.deletedAt) {
      return NextResponse.json({ orgId, restored: true, alreadyActive: true });
    }

    const member = await mongoose.connection
      .collection<OrgMemberRecord>("member")
      .findOne({ organizationId: orgId, userId: ctx.userId });
    if (!member || normalizeOrgRole(member.role) !== "owner") {
      throw new AuthzError(403, "organization_owner_required", "Forbidden");
    }

    await organizations.updateOne(
      { id: orgId },
      {
        $set: { updatedAt: new Date() },
        $unset: { deletedAt: "", scheduledPurgeAt: "" },
      },
    );

    await emitActivity({
      orgId,
      action: ActivityAction.ORG_RESTORED,
      actorUserId: ctx.userId,
      target: { type: "organization", id: orgId },
    });

    return NextResponse.json({ orgId, restored: true });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to restore organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
