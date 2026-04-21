import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription from "@/models/Subscription";
import { syncUserSubscriptionState } from "@/lib/subscriptions/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const { id } = await params;

  const subscription = await Subscription.findById(id);
  if (!subscription?.subscription_id) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  await razorpay.subscriptions.cancel(subscription.subscription_id, {
    cancel_at_cycle_end: false,
  } as never);

  subscription.status = "cancelled";
  subscription.cancelAtPeriodEnd = false;
  subscription.cancel_at_cycle_end = false;
  subscription.metadata = {
    ...subscription.metadata,
    cancelledByAdmin: true,
    cancelledAt: new Date().toISOString(),
  };
  await subscription.save();

  await syncUserSubscriptionState({
    userId: subscription.userId,
    subscriptionDocId: subscription._id,
    status: "cancelled",
    expiresAt: subscription.current_period_end || subscription.endDate || null,
    autopayActive: false,
  });

  return NextResponse.json({ success: true });
}
