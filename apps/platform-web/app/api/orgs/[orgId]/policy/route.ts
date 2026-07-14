import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMember, assertOrgMemberRole } from "@/lib/orgs/access";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import OrganizationPolicy, {
  type IOrganizationPolicy,
} from "@/models/OrganizationPolicy";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const BOOL_FIELDS: Array<keyof IOrganizationPolicy> = [
  "allowPublicLinks",
  "allowGuests",
  "allowExternalUploads",
  "requirePassword",
  "requireExpiry",
];

function serialize(policy: IOrganizationPolicy) {
  return {
    orgId: policy.orgId,
    allowPublicLinks: policy.allowPublicLinks,
    allowGuests: policy.allowGuests,
    allowExternalUploads: policy.allowExternalUploads,
    requirePassword: policy.requirePassword,
    requireExpiry: policy.requireExpiry,
  };
}

async function getOrCreatePolicy(orgId: string) {
  return OrganizationPolicy.findOneAndUpdate(
    { orgId },
    { $setOnInsert: { orgId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMember({ userId: ctx.userId, orgId });
    await dbConnect();
    const policy = await getOrCreatePolicy(orgId);
    return NextResponse.json({ policy: serialize(policy) });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load policy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    for (const field of BOOL_FIELDS) {
      if (typeof body[field] === "boolean") update[field] = body[field];
    }

    await dbConnect();
    await getOrCreatePolicy(orgId);
    const policy = await OrganizationPolicy.findOneAndUpdate(
      { orgId },
      { $set: update },
      { new: true },
    );

    await emitActivity({
      orgId,
      action: ActivityAction.ORG_SETTINGS_UPDATED,
      actorUserId: ctx.userId,
      target: { type: "policy", id: orgId },
      metadata: { fields: Object.keys(update) },
    });

    return NextResponse.json({ policy: policy ? serialize(policy) : null });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to update policy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
