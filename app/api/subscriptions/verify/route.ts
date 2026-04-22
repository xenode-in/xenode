import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription from "@/models/Subscription";
import {
  consumeCouponRedemptionIfNeeded,
  createSubscriptionPaymentIfMissing,
  createSubscriptionInvoiceIfMissing,
  syncUserSubscriptionState,
} from "@/lib/subscriptions/service";

export async function POST(request: NextRequest) {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    } = await request.json();

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    await dbConnect();

    const subscriptionDoc = await Subscription.findOne({
      subscription_id: razorpay_subscription_id,
    });
    if (!subscriptionDoc) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const fetchedSubscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    const amountPaise =
      subscriptionDoc.offerApplied && Number(subscriptionDoc.metadata?.offerAmount) > 0
        ? Number(subscriptionDoc.metadata?.offerAmount)
        : Number(subscriptionDoc.metadata?.basePlanAmount) || 99900;

    const invoiceResult = await createSubscriptionInvoiceIfMissing({
      subscriptionId: razorpay_subscription_id,
      paymentId: razorpay_payment_id,
      amountPaise,
      metadata: {
        source: "verify_route",
      },
    });

    subscriptionDoc.status = "active";
    subscriptionDoc.mandate_status = "approved";
    subscriptionDoc.current_period_start = fetchedSubscription.current_start
      ? new Date(fetchedSubscription.current_start * 1000)
      : subscriptionDoc.current_period_start;
    subscriptionDoc.current_period_end = fetchedSubscription.current_end
      ? new Date(fetchedSubscription.current_end * 1000)
      : subscriptionDoc.current_period_end;
    subscriptionDoc.endDate = subscriptionDoc.current_period_end || subscriptionDoc.endDate;
    subscriptionDoc.chargeCount = Math.max(
      subscriptionDoc.chargeCount ?? 0,
      invoiceResult.created ? 1 : subscriptionDoc.chargeCount ?? 1,
    );
    subscriptionDoc.paid_count = Math.max(subscriptionDoc.paid_count ?? 0, 1);
    await subscriptionDoc.save();

    await createSubscriptionPaymentIfMissing({
      userId: subscriptionDoc.userId,
      paymentId: razorpay_payment_id,
      subscriptionId: razorpay_subscription_id,
      planName:
        typeof subscriptionDoc.metadata?.planName === "string"
          ? subscriptionDoc.metadata.planName
          : subscriptionDoc.planSlug,
      billingCycle: subscriptionDoc.billingCycle,
      amountPaise,
      subscriptionStartDate:
        subscriptionDoc.current_period_start || subscriptionDoc.startDate,
      subscriptionEndDate:
        subscriptionDoc.current_period_end || subscriptionDoc.endDate,
      method: "upi_autopay",
      gatewayResponse: {
        source: "subscription_verify",
        invoiceCreated: invoiceResult.created,
        razorpaySubscriptionId: razorpay_subscription_id,
      },
    });

    await consumeCouponRedemptionIfNeeded({
      couponId:
        typeof subscriptionDoc.metadata?.couponId === "string"
          ? subscriptionDoc.metadata.couponId
          : null,
      userId: subscriptionDoc.userId,
      txnid: razorpay_payment_id,
    });

    await syncUserSubscriptionState({
      userId: subscriptionDoc.userId,
      subscriptionDocId: subscriptionDoc._id,
      status: "active",
      expiresAt: subscriptionDoc.current_period_end || subscriptionDoc.endDate,
      autopayActive: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
