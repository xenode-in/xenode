import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrganizationsEnabled, type OrganizationRecord } from "@/lib/orgs/access";
import OrgDomain from "@/models/OrgDomain";

export const dynamic = "force-dynamic";

/**
 * GET /api/orgs/domain-suggestions — organizations the caller could join based
 * on their verified email domain and the org's `domainJoinPolicy`.
 *
 * Surfaces `auto` orgs (self-joinable as guest via POST .../join) and `suggest`
 * orgs (ask an admin). Excludes orgs the user already belongs to.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();

    const email = ctx.session.user.email?.toLowerCase() ?? "";
    const domain = email.includes("@") ? email.split("@")[1] : "";
    if (!domain) return NextResponse.json({ suggestions: [] });

    await dbConnect();
    const verified = await OrgDomain.find({ domain, status: "verified" })
      .select("orgId")
      .lean<{ orgId: string }[]>();
    const orgIds = Array.from(new Set(verified.map((d) => d.orgId)));
    if (orgIds.length === 0) return NextResponse.json({ suggestions: [] });

    const [orgs, memberships] = await Promise.all([
      mongoose.connection
        .collection<OrganizationRecord>("organization")
        .find({ id: { $in: orgIds } })
        .toArray(),
      mongoose.connection
        .collection("member")
        .find({ userId: ctx.userId, organizationId: { $in: orgIds } })
        .toArray(),
    ]);
    const alreadyMember = new Set(memberships.map((m) => m.organizationId as string));

    const suggestions = orgs
      .filter(
        (org) =>
          !org.deletedAt &&
          !alreadyMember.has(org.id) &&
          (org.domainJoinPolicy === "auto" || org.domainJoinPolicy === "suggest"),
      )
      .map((org) => ({
        orgId: org.id,
        name: org.name,
        policy: org.domainJoinPolicy,
        // Only guest self-join is possible (E2EE: members need a wrapped key).
        selfJoinable:
          org.domainJoinPolicy === "auto" && org.autoJoinRequiresApproval !== true,
      }));

    return NextResponse.json({ suggestions });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load suggestions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
