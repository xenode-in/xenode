import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";
import {
  getRecurringPlanContext,
  syncUserSubscriptionState,
} from "@/lib/subscriptions/service";
import { changePlanSchema } from "@/lib/billing/validation/schemas";
import { parseJson, jsonError, BillingError } from "@/lib/billing/http";
import { findActiveSubscription } from "@/lib/billing/subscriptions";
import { calculateProration } from "@/lib/billing/proration";
import {
  cachedResponse,
  withIdempotency,
} from "@/lib/billing/idempotency";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";

/**
 * POST /api/subscriptions/change-plan
 *
 * Upgrade or downgrade the user's active subscription.
 *
 *   effective="immediate":
 *     - Razorpay swaps the plan immediately. The current cycle is finalized and
 *       the new plan takes effect from the start of the next cycle (Razorpay's
 *       `schedule_change_at: "now"` semantics).
 *     - We compute proration informationally (no credit note is issued yet — see
 *       lib/billing/proration.ts header for why).
 *
 *   effective="period_end":
 *     - We mark the subscription with `metadata.scheduledChange`. On the next
 *       `subscription.charged` webhook, a future job (P2 admin or follow-up
 *       webhook handler) reads this and applies the change.
 *     - For now we use Razorpay's `schedule_change_at: "cycle_end"` so the
 *       upgrade is effectively atomic.
 *
 * Both modes are idempotent under `Idempotency-Key`.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const input = await parseJson(request, changePlanSchema);

    const idempotency = await withIdempotency({
      request,
      userId,
      route: "subscriptions.change_plan",
      body: input,
    });
    const replay = cachedResponse(idempotency);
    if (replay) return replay;

    await dbConnect();

    const sub = await findActiveSubscription(userId);
    if (!sub?.subscription_id) {
      throw new BillingError(
        404,
        "No active subscription to change",
        "subscription_missing",
      );
    }
    if (sub.status !== "active") {
      throw new BillingError(
        409,
        `Subscription must be active to change plan (current: ${sub.status})`,
        "subscription_not_active",
      );
    }

    if (
      sub.planSlug === input.newPlanSlug &&
      sub.billingCycle === input.newBillingCycle
    ) {
      throw new BillingError(
        400,
        "New plan and cycle are the same as current",
        "no_change",
      );
    }

    const newPlanContext = await getRecurringPlanContext(
      input.newPlanSlug,
      input.newBillingCycle,
    );
    const newRazorpayPlanId = newPlanContext.pricingEntry.razorpayPlanId;
    if (!newRazorpayPlanId) {
      throw new BillingError(
        400,
        "Target plan is not configured for recurring billing on this cycle",
        "plan_not_recurring",
      );
    }

    // Compute informational proration if we have period bounds.
    const currentPlanPriceINR =
      Number(sub.metadata?.basePlanAmountINR) ||
      (Number(sub.metadata?.basePlanAmount) || 0) / 100;
    const proration =
      sub.current_period_start && sub.current_period_end && currentPlanPriceINR
        ? calculateProration({
            currentPlanPriceINR,
            currentCycle: sub.billingCycle,
            currentPeriodStart: sub.current_period_start,
            currentPeriodEnd: sub.current_period_end,
            newPlanPriceINR: newPlanContext.baseAmountPaise / 100,
          })
        : null;

    // Apply change via Razorpay. Note: PATCH /v1/subscriptions/:id per docs.
    // The razorpay-node SDK's `update()` maps to PATCH internally.
    await razorpay.subscriptions.update(sub.subscription_id, {
      plan_id: newRazorpayPlanId,
      schedule_change_at: input.effective === "immediate" ? "now" : "cycle_end",
      customer_notify: true,
    } as never);

    sub.metadata = {
      ...sub.metadata,
      previousPlanSlug: sub.planSlug,
      previousBillingCycle: sub.billingCycle,
      scheduledChange:
        input.effective === "period_end"
          ? {
              effectiveAt: sub.current_period_end?.toISOString() ?? null,
              newPlanSlug: input.newPlanSlug,
              newBillingCycle: input.newBillingCycle,
              newRazorpayPlanId,
            }
          : null,
      lastPlanChangeAt: new Date().toISOString(),
      lastProration: proration,
    };
    if (input.effective === "immediate") {
      sub.planSlug = input.newPlanSlug;
      sub.billingCycle = input.newBillingCycle;
      // Keep metadata in sync with the new plan so downstream syncs use the
      // correct base price and Razorpay plan id (storage limit is resolved
      // from PricingConfig by planSlug inside syncUserSubscriptionState).
      sub.metadata = {
        ...sub.metadata,
        basePlanAmount: newPlanContext.baseAmountPaise,
        basePlanAmountINR: newPlanContext.baseAmountPaise / 100,
        razorpayPlanId: newRazorpayPlanId,
        planName: newPlanContext.plan.name,
      };
    }
    await sub.save();

    if (input.effective === "immediate") {
      await syncUserSubscriptionState({
        userId,
        subscriptionDocId: sub._id,
        status: "active",
        expiresAt: sub.current_period_end || sub.endDate,
        autopayActive: true,
      });
    }

    await emitBillingEvent({
      type:
        input.effective === "immediate"
          ? "subscription.plan_changed"
          : "subscription.plan_change_scheduled",
      userId,
      actorType: "user",
      actorId: userId,
      subjectType: "subscription",
      subjectId: sub.subscription_id,
      payload: {
        from: {
          planSlug: sub.metadata?.previousPlanSlug,
          billingCycle: sub.metadata?.previousBillingCycle,
        },
        to: {
          planSlug: input.newPlanSlug,
          billingCycle: input.newBillingCycle,
        },
        effective: input.effective,
        proration,
      },
    });

    // Emit a credit-pending event for downgrades that leave the user with
    // unused paid days. Finance / admin can process actual Razorpay refunds
    // against this; we don't auto-issue refunds here.
    const creditOwedINR = proration
      ? Math.max(0, proration.unusedCreditINR - proration.newPlanChargeForRemainingINR)
      : 0;
    if (creditOwedINR > 0 && sub.subscription_id) {
      await emitBillingEvent({
        type: BillingEventType.PRORATION_CREDIT_PENDING,
        userId,
        actorType: "user",
        actorId: userId,
        subjectType: "subscription",
        subjectId: sub.subscription_id,
        payload: {
          creditOwedINR,
          unusedCreditINR: proration?.unusedCreditINR,
          newPlanChargeForRemainingINR: proration?.newPlanChargeForRemainingINR,
          daysRemaining: proration?.daysRemaining,
          fromPlanSlug: sub.metadata?.previousPlanSlug,
          toPlanSlug: input.newPlanSlug,
          effective: input.effective,
        },
      });
    }

    const body = {
      success: true,
      effective: input.effective,
      newPlanSlug: input.newPlanSlug,
      newBillingCycle: input.newBillingCycle,
      proration,
      creditOwedINR,
    };
    await idempotency.complete(200, body);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
