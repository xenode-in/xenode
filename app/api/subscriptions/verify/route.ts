import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription from "@/models/Subscription";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import {
  consumeCouponRedemptionIfNeeded,
  createSubscriptionPaymentIfMissing,
  createSubscriptionInvoiceIfMissing,
  syncUserSubscriptionState,
} from "@/lib/subscriptions/service";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";

/**
 * Razorpay subscription handler signature:
 *   generated_signature = HMAC_SHA256(payment_id + "|" + subscription_id, KEY_SECRET)
 * Uses constant-time comparison.
 */
function verifySubscriptionSignature(
  paymentId: string,
  subscriptionId: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

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

    if (
      !verifySubscriptionSignature(
        razorpay_payment_id,
        razorpay_subscription_id,
        razorpay_signature,
        process.env.RAZORPAY_KEY_SECRET || "",
      )
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    await dbConnect();

    // Fetch from Razorpay first — notes contain all metadata needed to
    // reconstruct the Subscription doc if it doesn't exist yet (i.e. the user
    // paid without the doc having been pre-created).
    const fetchedSubscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    const rzpNotes = ((fetchedSubscription as any).notes || {}) as Record<string, string>;

    let subscriptionDoc = await Subscription.findOne({
      subscription_id: razorpay_subscription_id,
    });

    const wasNewlyCreated = !subscriptionDoc;
    if (!subscriptionDoc) {
      const baseAmount = Number(rzpNotes.basePlanAmount) || 0;
      const firstCycleAmount = Number(rzpNotes.firstCycleAmount) || baseAmount;
      subscriptionDoc = await Subscription.create({
        userId: rzpNotes.userId,
        planSlug: rzpNotes.planSlug,
        status: "created",
        subscription_id: razorpay_subscription_id,
        billingCycle: rzpNotes.billingCycle || "monthly",
        startDate: new Date(),
        endDate: new Date(),
        total_count: (fetchedSubscription as any).total_count ?? 360,
        autoRenew: true,
        gateway: "razorpay",
        offerApplied: rzpNotes.offerApplied === "true",
        chargeCount: 0,
        paid_count: 0,
        cancelAtPeriodEnd: false,
        metadata: {
          authorizationUrl: (fetchedSubscription as any).short_url ?? null,
          offerSource: rzpNotes.offerSource || null,
          offerId: rzpNotes.offerId || null,
          discountPercent: rzpNotes.discountPercent ? Number(rzpNotes.discountPercent) : null,
          couponId: rzpNotes.couponId || null,
          couponCode: rzpNotes.couponCode || null,
          basePlanAmount: baseAmount,
          basePlanAmountINR: Number(rzpNotes.basePlanAmountINR) || 0,
          firstCycleAmount,
          firstCycleAmountINR: Number(rzpNotes.firstCycleAmountINR) || 0,
          planName: rzpNotes.planName || rzpNotes.planSlug || "",
          billingCycle: rzpNotes.billingCycle || "monthly",
          razorpayPlanId: rzpNotes.razorpayPlanId || "",
        },
      });
    }

    if (!subscriptionDoc?.userId) {
      return NextResponse.json(
        { error: "Subscription not found and could not be reconstructed from payment data" },
        { status: 404 },
      );
    }

    // Idempotency guard: if the webhook handler already processed this payment
    // (invoice exists AND subscription is active) we're done. Both /verify and
    // subscription.activated/charged paths can fire concurrently — the invoice
    // row is the natural key for "this activation already happened".
    const existingInvoice = await SubscriptionInvoice.findOne({
      payment_id: razorpay_payment_id,
    }).lean();
    if (existingInvoice && subscriptionDoc.status === "active") {
      return NextResponse.json({ success: true, alreadyProcessed: true });
    }

    // Use the first-cycle amount from our metadata (which accounts for any offer discount)
    const amountPaise =
      Number(subscriptionDoc.metadata?.firstCycleAmount) > 0
        ? Number(subscriptionDoc.metadata?.firstCycleAmount)
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

    if (wasNewlyCreated) {
      await emitBillingEvent({
        type: BillingEventType.SUBSCRIPTION_CREATED,
        userId: subscriptionDoc.userId,
        actorType: "user",
        actorId: subscriptionDoc.userId,
        subjectType: "subscription",
        subjectId: razorpay_subscription_id,
        payload: {
          planSlug: subscriptionDoc.planSlug,
          billingCycle: subscriptionDoc.billingCycle,
          offerApplied: subscriptionDoc.offerApplied,
          source: "verify_route",
        },
      });
    }

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
