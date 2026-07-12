import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import ShareAccessRequest from "@/models/ShareAccessRequest";
import { emitNotification } from "@/lib/notifications/emit";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ reqId: string }>;
}

async function isOrgOwnerAdmin(orgId: string, userId: string): Promise<boolean> {
  const member = await mongoose.connection
    .collection("member")
    .findOne({ organizationId: orgId, userId, role: { $in: ["owner", "admin"] } });
  return !!member;
}

/**
 * PATCH /api/direct-shares/access-requests/[reqId] — approve or deny a role
 * upgrade. Authorized for the share owner, or (org files) an org owner/admin.
 * Approving flips the recipient's `accessType` on the DirectShare in place.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { reqId } = await params;
    const body = await request.json().catch(() => ({}));
    const decision = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : null;
    if (!decision) {
      return NextResponse.json(
        { error: "decision must be 'approve' or 'deny'" },
        { status: 400 },
      );
    }

    await dbConnect();
    const req = await ShareAccessRequest.findById(reqId);
    if (!req) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (req.status !== "pending") {
      return NextResponse.json(
        { error: "This request has already been decided" },
        { status: 409 },
      );
    }

    const canDecide =
      req.ownerUserId === ctx.userId ||
      (!!req.orgId && (await isOrgOwnerAdmin(req.orgId, ctx.userId)));
    if (!canDecide) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (decision === "approve") {
      // Flip the recipient's role in place — the share key is already theirs.
      await DirectShare.updateOne(
        { _id: req.directShareId, isRevoked: false },
        { $set: { "recipients.$[r].accessType": req.requestedRole } },
        { arrayFilters: [{ "r.recipientUserId": req.requesterUserId }] },
      );
    }

    req.status = decision === "approve" ? "approved" : "denied";
    req.decidedBy = ctx.userId;
    req.decidedAt = new Date();
    await req.save();

    await emitNotification({
      userId: req.requesterUserId,
      type: "access_request_decided",
      title:
        decision === "approve"
          ? `Access granted — you're now a ${req.requestedRole}`
          : "Access request declined",
      body:
        decision === "approve"
          ? "You can now open the file with your new permissions."
          : undefined,
      orgId: req.orgId ?? null,
      metadata: {
        directShareId: String(req.directShareId),
        requestedRole: req.requestedRole,
        decision,
      },
    });

    return NextResponse.json({
      request: { id: String(req._id), status: req.status },
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to decide request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
