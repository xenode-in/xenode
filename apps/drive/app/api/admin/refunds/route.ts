import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { jsonError } from "@/lib/billing/http";
import dbConnect from "@/lib/mongodb";
import RefundRequest from "@/models/RefundRequest";

const VALID_STATUSES = [
  "pending",
  "approved",
  "processing",
  "completed",
  "denied",
  "failed",
] as const;
type Status = (typeof VALID_STATUSES)[number];

/**
 * GET /api/admin/refunds — list refund requests with filters.
 *
 * Default view: pending (admins need to take action). Pass ?status=all to see
 * everything, or status=completed for historical reference.
 *
 * Also returns counts grouped by status for the admin dashboard header.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const statusParam = sp.get("status") || "pending";
    const limit = Math.min(Number(sp.get("limit") || 50), 200);
    const skip = Math.max(0, Number(sp.get("skip") || 0));

    await dbConnect();

    const query: Record<string, unknown> = {};
    if (statusParam !== "all") {
      if (!(VALID_STATUSES as readonly string[]).includes(statusParam)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 },
        );
      }
      query.status = statusParam as Status;
    }

    const [rows, total, counts] = await Promise.all([
      RefundRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      RefundRequest.countDocuments(query),
      RefundRequest.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const countsByStatus: Record<string, number> = {};
    for (const s of VALID_STATUSES) countsByStatus[s] = 0;
    for (const c of counts) countsByStatus[c._id as string] = c.count;

    return NextResponse.json({
      total,
      countsByStatus,
      rows: rows.map((r) => ({
        id: String(r._id),
        userId: r.userId,
        ticketId: String(r.ticketId),
        razorpayPaymentId: r.razorpayPaymentId,
        razorpaySubscriptionId: r.razorpaySubscriptionId,
        amount: r.amount,
        currency: r.currency,
        reason: r.reason,
        status: r.status,
        eligibilityWindowEndsAt: r.eligibilityWindowEndsAt,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
        razorpayRefundId: r.razorpayRefundId,
        refundedAt: r.refundedAt,
        failureReason: r.failureReason,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
