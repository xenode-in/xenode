import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import { User } from "@/models/User";

/**
 * GET /api/admin/billing/failed-payments
 *
 * Filters:
 *   ?range=7|30|90        days back (default 30)
 *   ?plan=<slug>          plan filter (optional)
 *   ?reason=<text>        substring match against notes / error_description
 *
 * Returns latest 500 matching rows ordered by createdAt desc, plus aggregated
 * counts by reason for triage at a glance.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const range = Number(sp.get("range") || 30);
  const plan = sp.get("plan")?.trim();
  const reason = sp.get("reason")?.trim();

  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000);
  const query: Record<string, unknown> = {
    status: "failed",
    createdAt: { $gte: since },
  };
  if (plan) query.planName = plan;
  if (reason) query.notes = { $regex: reason, $options: "i" };

  await dbConnect();

  const [rows, byReason] = await Promise.all([
    Payment.find(query).sort({ createdAt: -1 }).limit(500).lean(),
    Payment.aggregate([
      { $match: query },
      { $group: { _id: "$notes", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const distinctUserIds = [...new Set(rows.map((r) => r.userId))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const users = distinctUserIds.length
    ? await User.find({ _id: { $in: distinctUserIds } })
        .select("email name")
        .lean()
    : [];
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return NextResponse.json({
    range,
    total: rows.length,
    byReason: byReason.map((b) => ({
      reason: b._id ?? "unknown",
      count: b.count,
    })),
    rows: rows.map((r) => {
      const user = userMap.get(r.userId);
      return {
        id: r._id.toString(),
        createdAt: r.createdAt,
        userEmail: user?.email ?? "Unknown",
        amount: r.amount,
        currency: r.currency,
        planName: r.planName,
        billingCycle: r.billingCycle,
        orderId: r.order_id,
        paymentId: r.payment_id,
        reason: r.notes ?? null,
        gatewayCode:
          (r.gatewayResponse as any)?.payload?.payment?.entity?.error_code ??
          null,
      };
    }),
  });
}
