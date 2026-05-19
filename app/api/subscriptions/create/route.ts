import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription, { type ISubscription } from "@/models/Subscription";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/subscriptions/constants";
import { getRecurringPlanContext } from "@/lib/subscriptions/service";
import { getActiveCampaign } from "@/lib/billing/campaigns";
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
 * Returns true if a subscription is an "abandoned checkout" — the row was
 * written when the user clicked Subscribe, but they never authorized the
 * Razorpay mandate, so no charge ever happened. We cancel these on retry so
 * the user isn't permanently locked out by their own browser-close.
 *
 * Intentionally restricted to `status === "created"` (and not "authenticated")
 * to avoid cancelling a real mandate that Razorpay is about to auto-charge.
 * An authenticated-but-uncharged sub with a stuck first charge should be
 * resolved manually via the admin panel or the reconcile cron.
 */
function isAbandonedCheckout(sub: Pick<
  ISubscription,
  "status" | "chargeCount" | "paid_count"
>): boolean {
  if (sub.status !== "created") return false;
  if ((sub.chargeCount ?? 0) > 0) return false;
  if ((sub.paid_count ?? 0) > 0) return false;
  return true;
}

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

    // Look for any subscription that would block creating a new one.
    const existing = await Subscription.findOne({
      userId,
      status: { $in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    });

    if (existing) {
      // Abandoned-checkout cleanup: the row exists but the user never
      // authorized / never paid. Cancel both the Razorpay sub (best-effort)
      // and the local doc, then fall through to create a fresh subscription.
      // Without this, closing the Razorpay modal once locks the user out
      // forever with 409 subscription_exists.
      if (isAbandonedCheckout(existing)) {
        if (existing.subscription_id) {
          try {
            await razorpay.subscriptions.cancel(existing.subscription_id, {
              cancel_at_cycle_end: false,
            } as never);
          } catch (cancelError) {
            // The Razorpay sub might already be cancelled / expired upstream.
            // Log but don't fail — the local cleanup is what matters.
            paymentLogger.error(
              `Failed to cancel abandoned Razorpay sub ${existing.subscription_id}; continuing`,
              cancelError,
            );
          }
        }
        existing.status = "cancelled";
        existing.metadata = {
          ...existing.metadata,
          cancelledAt: new Date().toISOString(),
          cancelledReason: "abandoned_checkout",
        };
        await existing.save();

        await emitBillingEvent({
          type: BillingEventType.SUBSCRIPTION_CANCELLED,
          userId,
          actorType: "system",
          actorId: "create-route-cleanup",
          subjectType: "subscription",
          subjectId: existing.subscription_id ?? existing._id.toString(),
          payload: {
            reason: "abandoned_checkout",
            planSlug: existing.planSlug,
            billingCycle: existing.billingCycle,
          },
        });
      } else {
        await idempotency.fail();
        throw new BillingError(
          409,
          "An active or pending subscription already exists",
          "subscription_exists",
        );
      }
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
