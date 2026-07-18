import { NextRequest, NextResponse } from "next/server";
import { AuthzError, isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { emitActivity } from "@/lib/orgs/activity";
import { emitNotification } from "@/lib/notifications/emit";
import AccessRequest from "@/models/AccessRequest";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; requestId: string }>;
}

/**
 * PATCH — approve or deny an access request (owner/admin). Approval is
 * a decision record + notification; the encrypted grant is issued through the
 * normal sharing flow afterwards (the server can't mint the key under E2EE).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, requestId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = await request.json().catch(() => ({}));
    const decision = body.decision === "approve" ? "approved" : body.decision === "deny" ? "denied" : null;
    if (!decision) {
      return NextResponse.json(
        { error: "decision must be 'approve' or 'deny'" },
        { status: 400 },
      );
    }

    await dbConnect();
    const accessRequest = await AccessRequest.findOne({ _id: requestId, orgId });
    if (!accessRequest) {
      throw new AuthzError(404, "access_request_not_found", "Access request not found");
    }
    if (accessRequest.status !== "pending") {
      throw new AuthzError(
        409,
        "access_request_decided",
        "This request has already been decided",
      );
    }

    accessRequest.status = decision;
    accessRequest.decidedBy = ctx.userId;
    accessRequest.decidedAt = new Date();
    await accessRequest.save();

    await emitActivity({
      orgId,
      action: `access_request.${decision}`,
      actorUserId: ctx.userId,
      target: { type: accessRequest.resourceType, id: accessRequest.resourceId },
      metadata: { requestId },
    });
    await emitNotification({
      userId: accessRequest.requesterUserId,
      type: "access_request_decided",
      title: decision === "approved" ? "Access request approved" : "Access request denied",
      body:
        decision === "approved"
          ? "An admin approved your access request."
          : "An admin denied your access request.",
      orgId,
      metadata: { requestId, decision },
    });

    return NextResponse.json({ id: requestId, status: decision });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to decide access request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
