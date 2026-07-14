import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMember } from "@/lib/orgs/access";
import { emitActivity } from "@/lib/orgs/activity";
import { emitNotificationToMany } from "@/lib/notifications/emit";
import AccessRequest, {
  type AccessRequestResource,
  type IAccessRequest,
} from "@/models/AccessRequest";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const RESOURCE_TYPES: AccessRequestResource[] = [
  "object",
  "bucket",
  "team",
  "org_membership",
];

function serialize(r: IAccessRequest) {
  return {
    id: r._id.toString(),
    orgId: r.orgId,
    requesterUserId: r.requesterUserId,
    resourceType: r.resourceType,
    resourceId: r.resourceId ?? null,
    note: r.note ?? null,
    status: r.status,
    decidedBy: r.decidedBy ?? null,
    decidedAt: r.decidedAt ?? null,
    createdAt: r.createdAt,
  };
}

async function orgAdminUserIds(orgId: string): Promise<string[]> {
  const admins = await mongoose.connection
    .collection("member")
    .find({ organizationId: orgId, role: { $in: ["owner", "admin", "manager"] } })
    .toArray();
  return admins.map((m) => m.userId as string);
}

/** GET — admins/managers see all requests; members/guests see only their own. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    const membership = await assertOrgMember({ userId: ctx.userId, orgId });
    const isTriager =
      membership.role === "owner" ||
      membership.role === "admin" ||
      membership.role === "manager";

    await dbConnect();
    const filter: Record<string, unknown> = { orgId };
    if (!isTriager) filter.requesterUserId = ctx.userId;
    const status = request.nextUrl.searchParams.get("status");
    if (status === "pending" || status === "approved" || status === "denied") {
      filter.status = status;
    }

    const requests = await AccessRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<IAccessRequest[]>();

    return NextResponse.json({
      requests: requests.map(serialize),
      canTriage: isTriager,
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load access requests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — any member/guest requests access; org admins are notified. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMember({ userId: ctx.userId, orgId });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const resourceType = body.resourceType as AccessRequestResource;
    if (!RESOURCE_TYPES.includes(resourceType)) {
      return NextResponse.json(
        { error: "A valid resourceType is required" },
        { status: 400 },
      );
    }
    const resourceId =
      typeof body.resourceId === "string" ? body.resourceId.trim() : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

    await dbConnect();
    const created = await AccessRequest.create({
      orgId,
      requesterUserId: ctx.userId,
      resourceType,
      resourceId,
      note,
      status: "pending",
    });

    await emitActivity({
      orgId,
      action: "access_request.created",
      actorUserId: ctx.userId,
      target: { type: resourceType, id: resourceId },
    });
    await emitNotificationToMany(await orgAdminUserIds(orgId), {
      type: "access_request",
      title: "New access request",
      body: `A member requested access to a ${resourceType.replace("_", " ")}.`,
      orgId,
      metadata: { requestId: created._id.toString(), resourceType, resourceId },
    });

    return NextResponse.json({ request: serialize(created) }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to create access request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
