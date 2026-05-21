import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";
import { getRecurringPlanContext } from "@/lib/subscriptions/service";
import { getActiveCampaign } from "@/lib/billing/campaigns";
import { createSubscriptionSchema } from "@/lib/billing/validation/schemas";
import { parseJson, jsonError, BillingError } from "@/lib/billing/http";
import { validateCoupon } from "@/lib/billing/coupons";
import { cachedResponse, withIdempotency } from "@/lib/billing/idempotency";
import { emitBillingEvent } from "@/lib/billing/events";
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

    // Block if user already has an active/authorized subscription.
    // "created" is excluded — subscription docs are no longer written until
    // payment is confirmed, so that status won't appear here.
    const existing = await Subscription.findOne({
      userId,
      status: { $in: ["authenticated", "active", "pending", "halted"] },
    });
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
      const activeCampaign = await getActiveCampaign({
        planSlug: input.planSlug,
        cycle: input.billingCycle,
      });
      if (activeCampaign?.razorpayOfferId) {
        // Admin-configured fallback: a bad offer must NOT block checkout.
        // Skip + emit an audit event so the admin can spot the misconfig.
        if (isValidRazorpayOfferId(activeCampaign.razorpayOfferId)) {
          offerId = activeCampaign.razorpayOfferId;
          offerSource = "campaign";
          discountPercent = activeCampaign.discountPercent;
        } else {
          paymentLogger.error(
            `Skipping malformed campaign offer_id: ${activeCampaign.razorpayOfferId}`,
          );
          await emitBillingEvent({
            type: "campaign.invalid_offer_id",
            actorType: "system",
            actorId: null,
            subjectType: "campaign",
            subjectId: activeCampaign.id,
            payload: {
              razorpayOfferId: activeCampaign.razorpayOfferId,
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

    // All fields needed to reconstruct the Subscription doc at payment time
    // are stored in Razorpay notes — no MongoDB write happens here.
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
        couponId,
        offerApplied: String(offerApplied),
        offerSource: offerSource || null,
        offerId: offerId || null,
        discountPercent: discountPercent !== null ? String(discountPercent) : null,
        basePlanAmount: String(baseAmountPaise),
        basePlanAmountINR: String(baseAmountPaise / 100),
        firstCycleAmount: String(firstCycleAmountPaise),
        firstCycleAmountINR: String(firstCycleAmountPaise / 100),
        razorpayPlanId: planContext.pricingEntry.razorpayPlanId,
      }),
    };
    if (offerId) subscriptionPayload.offer_id = offerId;

    const razorpaySubscription = await razorpay.subscriptions.create(
      subscriptionPayload as never,
    );

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
