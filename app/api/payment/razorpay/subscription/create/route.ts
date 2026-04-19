import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import PendingTransaction from "@/models/PendingTransaction";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      planId,
      planName,
      planSlug,
      billingCycle,
      storageLimitBytes,
      planPriceINR,
      basePlanPriceINR,
      totalCount = 12,
      customerNotify = true,
      trialDays = 0,
    } = await req.json();

    const options = {
      plan_id: planId,
      total_count: totalCount,
      customer_notify: customerNotify ? 1 : 0,
      ...(trialDays > 0 ? { start_at: Math.floor(Date.now() / 1000) + (trialDays * 24 * 60 * 60) } : {}),
      notes: {
        userId: session.user.id,
        planSlug,
      },
    };

    const razorpaySubscription = await razorpay.subscriptions.create(options as any);

    await dbConnect();

    // Store in PendingTransaction for consistency with one-time payments
    await PendingTransaction.create({
      txnid: razorpaySubscription.id,
      userId: session.user.id,
      planName,
      planSlug,
      storageLimitBytes,
      planPriceINR,
      basePlanPriceINR,
      billingCycle,
      paymentMethod: "autopay",
      gateway: "razorpay",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      expectedAmount: planPriceINR,
    });

    // Create a 'created' subscription record
    await Subscription.findOneAndUpdate(
      { userId: session.user.id },
      {
        $set: {
          subscription_id: razorpaySubscription.id,
          planSlug,
          status: "created",
          billingCycle,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Provisional 
          total_count: totalCount,
          autoRenew: true,
          gateway: "razorpay",
        }
      },
      { upsert: true }
    );

    return NextResponse.json({
      subscriptionId: razorpaySubscription.id,
      shortUrl: razorpaySubscription.short_url,
    });
  } catch (error: any) {
    console.error("Razorpay Subscription Creation Error:", error);
    return NextResponse.json({ error: error.message || "Failed to create subscription" }, { status: 500 });
  }
}
