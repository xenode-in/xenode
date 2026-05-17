import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/subscriptions/constants";
import {
  getRecurringPlanContext,
  getActiveSubscriptionOffer,
} from "@/lib/subscriptions/service";
import { createSubscriptionSchema } from "@/lib/billing/validation/schemas";
import { parseJson, jsonError, BillingError } from "@/lib/billing/http";
import { validateCoupon } from "@/lib/billing/coupons";
import { cachedResponse, withIdempotency } from "@/lib/billing/idempotency";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";
import {
  cleanNotes,
  isValidRazorpayOfferId,
  paymentLogger,
} from "@/lib/payment/razorpayUtils";

/**
 * POST /api/subscriptions/create
 *
 * Creates a Razorpay recurring subscription with optional discount sources:
 *   - Coupon (with linked razorpayOfferId)  — takes priority
 *   - Active campaign offer                  — auto-applied fallback
 *
 * Supports `Idempotency-Key` header for safe retries (duplicate submits won't
 * create duplicate Razorpay subscriptions).
 *
 * Aligned with current Razorpay docs (verified Jan 2026):
 *   - `customer_notify` is a boolean
 *   - `offer_id` must match `^offer_[A-Za-z0-9]{14}$`
 *   - `notes` strips empty values
 *   - User-supplied (coupon) bad offer IDs throw 400 with a clear message;
 *     admin-configured (campaign) bad offer IDs are skipped + logged so a
 *     misconfigured offer never blocks subscription creation.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const input = await parseJson(request, createSubscriptionSchema);

    // Idempotency reservation (no-op if header absent).
    const idempotency = await withIdempotency({
      request,
      userId,
      route: "subscriptions.create",
      body: input,
    });
    const replay = cachedResponse(idempotency);
    if (replay) return replay;

    await dbConnect();

    // Reject if the user already has an active/pending subscription.
    const existing = await Subscription.findOne({
      userId,
      status: { $in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    }).lean();
    if (existing) {
      await idempotency.fail();
      throw new BillingError(
        409,
        "An active or pending subscription already exists",
        "subscription_exists",
      );
    }

    const planContext = await getRecurringPlanContext(
      input.planSlug,
      input.billingCycle,
    );
    const baseAmountPaise = planContext.baseAmountPaise;

    // Resolve discount: coupon first, campaign fallback.
    let offerId: string | null = null;
    let offerSource: "coupon" | "campaign" | null = null;
    let discountPercent: number | null = null;
    let couponId: string | null = null;
    let couponCodeUsed: string | null = null;

    if (input.couponCode) {
      const coupon = await validateCoupon({
        code: input.couponCode,
        userId,
        planSlug: input.planSlug,
        requireRazorpayOffer: true,
      });
      // User-facing: a misconfigured coupon should fail loudly.
      if (!isValidRazorpayOfferId(coupon.razorpayOfferId)) {
        throw new BillingError(
          400,
          "This coupon's offer is misconfigured. Please contact support.",
          "coupon_invalid_offer_id",
        );
      }
      offerId = coupon.razorpayOfferId;
      offerSource = "coupon";
      discountPercent =
        coupon.discountType === "percent" ? coupon.discountValue : null;
      couponId = coupon.id;
      couponCodeUsed = coupon.code;
    }

    if (!offerId) {
      const activeOffer = await getActiveSubscriptionOffer();
      if (activeOffer?.razorpayOfferId) {
        // Admin-configured fallback: a bad offer must NOT block checkout.
        // Skip + emit an audit event so the admin can spot the misconfig.
        if (isValidRazorpayOfferId(activeOffer.razorpayOfferId)) {
          offerId = activeOffer.razorpayOfferId;
          offerSource = "campaign";
          discountPercent = activeOffer.discountPercent;
        } else {
          paymentLogger.error(
            `Skipping malformed campaign offer_id: ${activeOffer.razorpayOfferId}`,
          );
          await emitBillingEvent({
            type: "campaign.invalid_offer_id",
            actorType: "system",
            actorId: null,
            subjectType: "subscription_offer",
            subjectId: activeOffer._id?.toString?.() ?? null,
            payload: {
              razorpayOfferId: activeOffer.razorpayOfferId,
              expectedPattern: "^offer_[A-Za-z0-9]{14}$",
            },
          });
        }
      }
    }

    const offerApplied = !!offerId;
    const firstCycleAmountPaise =
      offerApplied && discountPercent
        ? Math.max(
            100,
            Math.round(baseAmountPaise * (1 - discountPercent / 100)),
          )
        : baseAmountPaise;

    // Razorpay total_count limits per cycle (docs verified 2026-01):
    //   monthly: 1-360, quarterly: 1-120, yearly: 1-30
    const maxTotalCount =
      input.billingCycle === "yearly"
        ? 30
        : input.billingCycle === "quarterly"
          ? 120
          : 360;

    const subscriptionPayload: Record<string, unknown> = {
      plan_id: planContext.pricingEntry.razorpayPlanId,
      total_count: maxTotalCount,
      quantity: 1,
      customer_notify: true,
      notes: cleanNotes({
        userId,
        planSlug: planContext.plan.slug,
        planName: planContext.plan.name,
        billingCycle: input.billingCycle,
        phone: input.phone || null,
        couponCode: couponCodeUsed,
        amountPaise: String(baseAmountPaise),
      }),
    };
    if (offerId) subscriptionPayload.offer_id = offerId;

    const razorpaySubscription = await razorpay.subscriptions.create(
      subscriptionPayload as never,
    );

    const subscriptionDoc = await Subscription.create({
      userId,
      planSlug: planContext.plan.slug,
      status: "created",
      subscription_id: razorpaySubscription.id,
      billingCycle: input.billingCycle,
      startDate: new Date(),
      endDate: new Date(),
      total_count: maxTotalCount,
      autoRenew: true,
      gateway: "razorpay",
      offerApplied,
      chargeCount: 0,
      cancelAtPeriodEnd: false,
      metadata: {
        authorizationUrl: razorpaySubscription.short_url,
        offerSource,
        offerId,
        discountPercent,
        couponId,
        couponCode: couponCodeUsed,
        basePlanAmount: baseAmountPaise,
        basePlanAmountINR: baseAmountPaise / 100,
        firstCycleAmount: firstCycleAmountPaise,
        firstCycleAmountINR: firstCycleAmountPaise / 100,
        planName: planContext.plan.name,
        billingCycle: input.billingCycle,
        razorpayPlanId: planContext.pricingEntry.razorpayPlanId,
      },
    });

    await emitBillingEvent({
      type: BillingEventType.SUBSCRIPTION_CREATED,
      userId,
      actorType: "user",
      actorId: userId,
      subjectType: "subscription",
      subjectId: razorpaySubscription.id,
      payload: {
        planSlug: planContext.plan.slug,
        billingCycle: input.billingCycle,
        offerSource,
        offerApplied,
        discountPercent,
        basePlanAmountPaise: baseAmountPaise,
        firstCycleAmountPaise,
        subscriptionDocId: subscriptionDoc._id.toString(),
      },
    });

    const responseBody = {
      subscriptionId: razorpaySubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: razorpaySubscription.short_url,
      offerApplied,
      offerSource,
      amount: (offerApplied ? firstCycleAmountPaise : baseAmountPaise) / 100,
    };
    await idempotency.complete(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Error creating subscription:", error);
    return jsonError(error);
  }
}
