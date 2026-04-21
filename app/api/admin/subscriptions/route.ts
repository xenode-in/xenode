import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import { User } from "@/models/User";

const DEFAULT_MONTHLY_AMOUNT_INR = 999;

export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const statusFilter = request.nextUrl.searchParams.get("status");
  const search = (request.nextUrl.searchParams.get("search") || "").trim();

  const query: Record<string, unknown> = {};
  if (statusFilter) {
    query.status = statusFilter;
  }

  let userIds: string[] | null = null;
  if (search) {
    const matchedUsers = await User.find({
      email: { $regex: search, $options: "i" },
    })
      .select("_id")
      .lean();
    userIds = matchedUsers.map((user) => user._id.toString());
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

  const userMap = new Map(users.map((user) => [user._id.toString(), user]));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const stats = {
    activeSubs: subscriptions.filter((sub) => sub.status === "active").length,
    mrr:
      subscriptions.filter((sub) => sub.status === "active").length *
      DEFAULT_MONTHLY_AMOUNT_INR,
    churnedThisMonth: subscriptions.filter(
      (sub) =>
        sub.status === "cancelled" &&
        new Date(sub.updatedAt).getTime() >= monthStart.getTime(),
    ).length,
    offerSubs: subscriptions.filter((sub) => sub.offerApplied).length,
    regularSubs: subscriptions.filter((sub) => !sub.offerApplied).length,
  };

  return NextResponse.json({
    stats,
    subscriptions: subscriptions.map((sub) => {
      const user = userMap.get(sub.userId);
      return {
        id: sub._id.toString(),
        userEmail: user?.email || "Unknown",
        userName: user?.name || "Unknown",
        plan: sub.planSlug,
        status: sub.status,
        amount:
          (Number(sub.metadata?.offerAmount) ||
            Number(sub.metadata?.basePlanAmount) ||
            DEFAULT_MONTHLY_AMOUNT_INR * 100) / 100,
        offerApplied: sub.offerApplied || false,
        nextBilling:
          sub.current_period_end || sub.endDate || sub.updatedAt || sub.createdAt,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
        subscriptionId: sub.subscription_id,
      };
    }),
  });
}
