import { NextRequest, NextResponse } from "next/server";
import { ProductSession } from "@xenode/database";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import { assertOrgMember, assertOrganizationsEnabled } from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";

export const dynamic = "force-dynamic";

/**
 * POST /api/orgs/active - set (or clear) the caller's active organization.
 *
 * Membership is enforced with Xenode's member collection, then the pointer is
 * persisted on the caller's Drive ProductSession. It is a UI convenience
 * only — every request still authorizes by the requested `spaceId`, never by
 * this field.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const body = await request.json().catch(() => ({}));
    const orgId =
      typeof body.orgId === "string" && body.orgId.trim()
        ? body.orgId.trim()
        : null;

    if (orgId) {
      await assertOrgMember({ userId: ctx.userId, orgId });
    }

    await dbConnect();
    const result = await ProductSession.updateOne(
      {
        sessionId: ctx.session.session.id,
        productId: "drive",
        revokedAt: { $exists: false },
      },
      { $set: { activeOrganizationId: orgId } },
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        {
          error: "Failed to persist active organization",
          code: "active_organization_not_persisted",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      activeOrganizationId: orgId,
      scope: orgId ? "organization" : "personal",
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to switch organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
