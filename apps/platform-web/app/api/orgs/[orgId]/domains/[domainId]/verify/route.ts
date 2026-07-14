import { resolveTxt } from "dns/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { enforceRateLimit } from "@/lib/ratelimit/limiter";
import OrgDomain from "@/models/OrgDomain";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; domainId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, domainId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });
    await enforceRateLimit({
      key: `domain-verify:${orgId}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    await dbConnect();

    const domain = await OrgDomain.findOne({ _id: domainId, orgId });
    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const now = new Date();
    const records = await resolveTxt(domain.domain).catch(() => []);
    const txtValues = records.map((record) => record.join(""));
    const verified = txtValues.includes(domain.verificationToken);

    domain.status = verified ? "verified" : "failed";
    domain.verifiedAt = verified ? now : null;
    domain.lastCheckedAt = now;
    await domain.save();

    await emitActivity({
      orgId,
      action: verified
        ? ActivityAction.DOMAIN_VERIFIED
        : ActivityAction.DOMAIN_VERIFICATION_FAILED,
      actorUserId: ctx.userId,
      target: { type: "domain", id: domain._id.toString() },
      metadata: { domain: domain.domain },
    });

    if (!verified) {
      return NextResponse.json(
        {
          error: "TXT record was not found",
          domain: {
            id: domain._id.toString(),
            domain: domain.domain,
            verificationToken: domain.verificationToken,
            status: domain.status,
            verifiedAt: domain.verifiedAt ?? null,
            lastCheckedAt: domain.lastCheckedAt ?? null,
          },
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      domain: {
        id: domain._id.toString(),
        domain: domain.domain,
        verificationToken: domain.verificationToken,
        status: domain.status,
        verifiedAt: domain.verifiedAt ?? null,
        lastCheckedAt: domain.lastCheckedAt ?? null,
      },
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to verify organization domain";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
