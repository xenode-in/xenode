import { NextRequest, NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import dbConnect from "@/lib/mongodb";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subscriptionId } = await request.json().catch(() => ({ subscriptionId: null }));

    await dbConnect();

    const subscriptionDoc = subscriptionId
      ? await Subscription.findOne({
          userId: session.user.id,
          subscription_id: subscriptionId,
        })
      : await Subscription.findOne({ userId: session.user.id }).sort({ createdAt: -1 });

    if (!subscriptionDoc?.subscription_id) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    await razorpay.subscriptions.cancel(subscriptionDoc.subscription_id, {
      cancel_at_cycle_end: true,
    } as never);

    subscriptionDoc.cancelAtPeriodEnd = true;
    subscriptionDoc.cancel_at_cycle_end = true;
    await subscriptionDoc.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to cancel subscription";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
