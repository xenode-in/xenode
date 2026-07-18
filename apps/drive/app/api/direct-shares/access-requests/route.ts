import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import ShareAccessRequest from "@/models/ShareAccessRequest";

export const dynamic = "force-dynamic";

/**
 * GET /api/direct-shares/access-requests?box=incoming|outgoing[&status=pending]
 *
 * - incoming: requests the caller can act on — ones they own, plus any for org
 *   files where they're an org owner/admin.
 * - outgoing: requests the caller made.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const box = request.nextUrl.searchParams.get("box") === "outgoing" ? "outgoing" : "incoming";
    const statusParam = request.nextUrl.searchParams.get("status");

    await dbConnect();

    const filter: Record<string, unknown> = {};
    if (statusParam === "pending" || statusParam === "approved" || statusParam === "denied") {
      filter.status = statusParam;
    }

    if (box === "outgoing") {
      filter.requesterUserId = ctx.userId;
    } else {
      const adminOrgs = await mongoose.connection
        .collection("member")
        .find({ userId: ctx.userId, role: { $in: ["owner", "admin"] } })
        .toArray();
      const adminOrgIds = adminOrgs.map((m) => m.organizationId as string);
      filter.$or = [
        { ownerUserId: ctx.userId },
        ...(adminOrgIds.length ? [{ orgId: { $in: adminOrgIds } }] : []),
      ];
    }

    const requests = await ShareAccessRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: String(r._id),
        directShareId: String(r.directShareId),
        objectId: String(r.objectId),
        requesterUserId: r.requesterUserId,
        requesterEmail: r.requesterEmail ?? null,
        currentRole: r.currentRole,
        requestedRole: r.requestedRole,
        note: r.note ?? null,
        status: r.status,
        orgId: r.orgId ?? null,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load access requests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
