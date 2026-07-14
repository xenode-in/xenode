import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { assertOrgMember, assertOrgMemberRole } from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import OrgDomain, { type IOrgDomain } from "@/models/OrgDomain";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const domain = withoutProtocol.split("/")[0].replace(/\.$/, "");
  if (!/^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) {
    return "";
  }
  return domain;
}

function serializeDomain(domain: IOrgDomain) {
  return {
    id: domain._id.toString(),
    orgId: domain.orgId,
    domain: domain.domain,
    verificationToken: domain.verificationToken,
    status: domain.status,
    method: domain.method,
    verifiedAt: domain.verifiedAt ?? null,
    lastCheckedAt: domain.lastCheckedAt ?? null,
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMember({ userId: ctx.userId, orgId });
    await dbConnect();

    const domains = await OrgDomain.find({ orgId }).sort({ createdAt: -1 });
    return NextResponse.json({ domains: domains.map(serializeDomain) });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to list organization domains";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = await request.json().catch(() => ({}));
    const domain = normalizeDomain(body.domain);
    if (!domain) {
      return NextResponse.json(
        { error: "A valid domain is required" },
        { status: 400 },
      );
    }

    await dbConnect();
    const existing = await OrgDomain.findOne({ orgId, domain });
    if (existing) {
      return NextResponse.json(
        { error: "Domain already exists for this organization" },
        { status: 409 },
      );
    }

    const verificationToken = `xenode-org-verification=${randomBytes(18).toString("hex")}`;
    const created = await OrgDomain.create({
      orgId,
      domain,
      verificationToken,
      status: "pending",
      method: "dns_txt",
      createdBy: ctx.userId,
    });

    await emitActivity({
      orgId,
      action: ActivityAction.DOMAIN_ADDED,
      actorUserId: ctx.userId,
      target: { type: "domain", id: created._id.toString() },
      metadata: { domain },
    });

    return NextResponse.json(
      { domain: serializeDomain(created) },
      { status: 201 },
    );
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to add organization domain";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
