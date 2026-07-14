import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Subscription from "@/models/Subscription";

/**
 * GET /api/billing/invoices
 *
 * Returns the authenticated user's invoices, newest first. Joined against
 * Subscription to scope the query to the caller (SubscriptionInvoice itself
 * has no userId — it links via subscription_id).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const subs = await Subscription.find({ userId: session.user.id })
    .select("subscription_id planSlug billingCycle")
    .lean();
  const subIds = subs
    .map((s) => s.subscription_id)
    .filter((id): id is string => !!id);
  if (subIds.length === 0) {
    return NextResponse.json({ invoices: [] });
  }

  const invoices = await SubscriptionInvoice.find({
    subscription_id: { $in: subIds },
  })
    .sort({ billing_date: -1 })
    .limit(100)
    .lean();

  const subMap = new Map(
    subs.map((s) => [
      s.subscription_id ?? "",
      { plan: s.planSlug, cycle: s.billingCycle },
    ]),
  );

  return NextResponse.json({
    invoices: invoices.map((inv) => ({
      id: inv._id.toString(),
      number: inv.number ?? null,
      paymentId: inv.payment_id,
      subscriptionId: inv.subscription_id,
      amount: inv.amount,
      status: inv.status,
      billingDate: inv.billing_date,
      plan: subMap.get(inv.subscription_id)?.plan ?? null,
      cycle: subMap.get(inv.subscription_id)?.cycle ?? null,
    })),
  });
}
