import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import Payment from "@/models/Payment";
import { User } from "@/models/User";

/**
 * Admin subscriptions overview.
 *
 * MRR is computed from successful Payment records this month, normalised to a
 * monthly equivalent based on billingCycle (yearly /12, quarterly /3). This
 * replaces the previous hardcoded `activeSubs × ₹999` calculation, which was
 * meaningless for any pricing other than the base plan.
 */

const MONTHLY_DIVISOR: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
  lifetime: 1, // recognise lifetime payments only in the month they happen
};

function startOfMonthUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function computeMRR(monthStart: Date): Promise<number> {
  const successPayments = await Payment.find({
    status: "success",
    createdAt: { $gte: monthStart },
  })
    .select("amount billingCycle")
    .lean<{ amount: number; billingCycle?: string }[]>();

  let total = 0;
  for (const p of successPayments) {
    const divisor = MONTHLY_DIVISOR[p.billingCycle ?? "monthly"] ?? 1;
    total += (p.amount || 0) / divisor;
  }
  return Math.round(total);
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const statusFilter = request.nextUrl.searchParams.get("status");
  const search = (request.nextUrl.searchParams.get("search") || "").trim();

  const query: Record<string, unknown> = {};
  if (statusFilter) query.status = statusFilter;

  if (search) {
    const matchedUsers = await User.find({
      email: { $regex: search, $options: "i" },
    })
      .select("_id")
      .lean();
    const userIds = matchedUsers.map((u) => u._id.toString());
    query.userId = { $in: userIds.length > 0 ? userIds : ["__none__"] };
  }

  const subscriptions = await Subscription.find(query)
    .sort({ createdAt: -1 })
    .lean();

  const distinctUserIds = [...new Set(subscriptions.map((sub) => sub.userId))];
  const users = await User.find({
    _id: {
      $in: distinctUserIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  })
    .select("email name")
    .lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const monthStart = startOfMonthUTC(new Date());
  const mrr = await computeMRR(monthStart);

  const activeSubs = subscriptions.filter((sub) => sub.status === "active").length;
  const churnedThisMonth = subscriptions.filter(
    (sub) =>
      sub.status === "cancelled" &&
      new Date(sub.updatedAt).getTime() >= monthStart.getTime(),
  ).length;

  return NextResponse.json({
    stats: {
      activeSubs,
      mrr,
      arr: mrr * 12,
      churnedThisMonth,
      offerSubs: subscriptions.filter((sub) => sub.offerApplied).length,
      regularSubs: subscriptions.filter((sub) => !sub.offerApplied).length,
    },
    subscriptions: subscriptions.map((sub) => {
      const user = userMap.get(sub.userId);
      const basePaise = Number(sub.metadata?.basePlanAmount) || 0;
      const offerPaise = Number(sub.metadata?.firstCycleAmount) || basePaise;
      return {
        id: sub._id.toString(),
        userEmail: user?.email || "Unknown",
        userName: user?.name || "Unknown",
        plan: sub.planSlug,
        billingCycle: sub.billingCycle,
        status: sub.status,
        amount: (offerPaise || basePaise) / 100,
        offerApplied: sub.offerApplied || false,
        nextBilling:
          sub.current_period_end || sub.endDate || sub.updatedAt || sub.createdAt,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
        subscriptionId: sub.subscription_id,
      };
    }),
  });
}
