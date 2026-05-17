import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Subscription from "@/models/Subscription";

/**
 * GET /api/billing/invoices/[id]
 *
 * Single invoice (JSON). Owner-scoped via the subscription linkage. PDF
 * generation deferred — JSON is enough to render an invoice client-side.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  await dbConnect();
  const invoice = await SubscriptionInvoice.findById(id).lean();
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sub = await Subscription.findOne({
    subscription_id: invoice.subscription_id,
  })
    .select("userId planSlug billingCycle")
    .lean();
  if (!sub || sub.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: invoice._id.toString(),
    number: invoice.number ?? null,
    paymentId: invoice.payment_id,
    subscriptionId: invoice.subscription_id,
    amount: invoice.amount,
    currency: "INR",
    status: invoice.status,
    billingDate: invoice.billing_date,
    plan: sub.planSlug,
    cycle: sub.billingCycle,
  });
}
