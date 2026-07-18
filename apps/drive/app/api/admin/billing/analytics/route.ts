import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import BillingEvent from "@/models/BillingEvent";
import Campaign from "@/models/Campaign";

/**
 * GET /api/admin/billing/analytics
 *
 * One endpoint, everything an exec dashboard needs:
 *   - MRR / ARR / ARPU (current month, normalized by cycle)
 *   - Active subscriptions by plan
 *   - Churn (cancelled this month / last 3 months)
 *   - Campaign performance (redemptions + value)
 *   - Coupon redemptions (count)
 *
 * All computed from Payment / Subscription / BillingEvent / Campaign — no
 * separate analytics store, no nightly rollup. Cheap enough to recompute on
 * each call for the foreseeable user base.
 */

const MONTHLY_DIVISOR: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
  lifetime: 1,
};

function startOfMonthUTC(now: Date, monthsBack = 0): Date {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const now = new Date();
  const monthStart = startOfMonthUTC(now);
  const threeMonthsAgo = startOfMonthUTC(now, 3);

  // ── MRR (this month, normalized to monthly) ────────────────────────────
  const monthPayments = await Payment.find({
    status: "success",
    createdAt: { $gte: monthStart },
  })
    .select("amount billingCycle")
    .lean<{ amount: number; billingCycle?: string }[]>();

  let mrr = 0;
  for (const p of monthPayments) {
    const divisor = MONTHLY_DIVISOR[p.billingCycle ?? "monthly"] ?? 1;
    mrr += (p.amount || 0) / divisor;
  }
  mrr = Math.round(mrr);

  // ── Active subs + by-plan breakdown ────────────────────────────────────
  const activeSubsByPlan = await Subscription.aggregate([
    { $match: { status: "active" } },
    { $group: { _id: "$planSlug", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const activeSubsTotal = activeSubsByPlan.reduce(
    (sum, p) => sum + p.count,
    0,
  );

  // ── ARPU ───────────────────────────────────────────────────────────────
  const arpu =
    activeSubsTotal > 0 ? Math.round(mrr / activeSubsTotal) : 0;

  // ── Churn ──────────────────────────────────────────────────────────────
  const [churnedThisMonth, churnedLast3Months] = await Promise.all([
    Subscription.countDocuments({
      status: "cancelled",
      updatedAt: { $gte: monthStart },
    }),
    Subscription.countDocuments({
      status: "cancelled",
      updatedAt: { $gte: threeMonthsAgo },
    }),
  ]);

  // ── Campaign performance ───────────────────────────────────────────────
  const campaigns = await Campaign.find().sort({ priority: 1 }).lean();
  const campaignPerformance = campaigns.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    slug: c.slug,
    isActive: c.isActive,
    discountPercent: c.discountPercent,
    flatDiscountPaise: c.flatDiscountPaise,
    redeemedCount: c.redeemedCount,
    maxRedemptions: c.maxRedemptions,
  }));

  // ── Coupon redemptions (this month) ────────────────────────────────────
  const couponRedemptions = await BillingEvent.countDocuments({
    type: "coupon.redeemed",
    createdAt: { $gte: monthStart },
  });

  return NextResponse.json({
    now: now.toISOString(),
    mrr,
    arr: mrr * 12,
    arpu,
    activeSubs: {
      total: activeSubsTotal,
      byPlan: activeSubsByPlan.map((p) => ({
        plan: p._id,
        count: p.count,
      })),
    },
    churn: {
      thisMonth: churnedThisMonth,
      last3Months: churnedLast3Months,
    },
    campaigns: campaignPerformance,
    couponRedemptionsThisMonth: couponRedemptions,
  });
}
