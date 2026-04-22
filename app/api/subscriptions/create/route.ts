import { NextRequest, NextResponse } from "next/server";
import type { BillingCycle } from "@/types/pricing";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/subscriptions/constants";
import {
  createRazorpayRecurringPlan,
  getRecurringFirstCyclePricing,
  scheduleBasePlanUpgrade,
} from "@/lib/subscriptions/service";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const phone = typeof body?.phone === "string" ? body.phone : "";
    const planSlug = typeof body?.planSlug === "string" ? body.planSlug : "";
    const couponCode =
      typeof body?.couponCode === "string" ? body.couponCode.trim() : "";
    const billingCycle =
      typeof body?.billingCycle === "string"
        ? (body.billingCycle as BillingCycle)
        : "monthly";

    if (!planSlug) {
      return NextResponse.json({ error: "planSlug is required" }, { status: 400 });
    }

    await dbConnect();

    const existing = await Subscription.findOne({
      userId: session.user.id,
      status: { $in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    }).lean();

    if (existing) {
      return NextResponse.json(
        { error: "An active or pending subscription already exists" },
        { status: 409 },
      );
    }

    // ── Resolve pricing (base + campaign + coupon) ──────────────────────
    const pricing = await getRecurringFirstCyclePricing({
      userId: session.user.id,
      planSlug,
      billingCycle,
      couponCode: couponCode || null,
    });

    // ── Determine the Razorpay plan to use ──────────────────────────────
    //
    // If there's a first-cycle discount, we create a temporary Razorpay plan
    // at the discounted price and immediately schedule the subscription to
    // upgrade to the base plan at the end of the first cycle.
    //
    // If there's no discount, we use the base plan directly.
    //
    // In BOTH cases: total_count = 0 (unlimited recurring), single mandate.

    let planId = pricing.pricingEntry.razorpayPlanId!;
    let discountedPlanId: string | null = null;

    if (pricing.hasFirstCycleDiscount) {
      const tempPlan = await createRazorpayRecurringPlan({
        amountPaise: pricing.firstCycleAmountPaise,
        name: `${pricing.plan.name} - Intro ${billingCycle}`,
        billingCycle,
        description: `First-cycle introductory plan for ${pricing.plan.name}`,
      });
      discountedPlanId = tempPlan.id;
      planId = tempPlan.id;
    }

    // ── Create the Razorpay subscription ────────────────────────────────
    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 0, // Always unlimited — Razorpay handles plan transitions
      customer_notify: 1,
      notes: {
        userId: session.user.id,
        planSlug: pricing.plan.slug,
        planName: pricing.plan.name,
        billingCycle,
        couponCode: pricing.coupon?.code || "",
        phone,
        amountPaise: String(
          pricing.hasFirstCycleDiscount
            ? pricing.firstCycleAmountPaise
            : pricing.baseAmountPaise,
        ),
      },
    } as never);

    // ── Schedule base plan upgrade if discounted ────────────────────────
    //
    // This calls the Razorpay Update Subscription API with
    // schedule_change_at: "cycle_end" so the subscription automatically
    // switches to the base plan after the first cycle. No second mandate.
    let basePlanScheduled = false;

    if (pricing.hasFirstCycleDiscount) {
      await scheduleBasePlanUpgrade({
        razorpaySubscriptionId: razorpaySubscription.id,
        basePlanId: pricing.pricingEntry.razorpayPlanId!,
      });
      basePlanScheduled = true;
    }

    // ── Save to database ────────────────────────────────────────────────
    await Subscription.create({
      userId: session.user.id,
      planSlug: pricing.plan.slug,
      status: "created",
      subscription_id: razorpaySubscription.id,
      billingCycle,
      startDate: new Date(),
      endDate: new Date(),
      total_count: 0,
      autoRenew: true,
      gateway: "razorpay",
      offerApplied: pricing.hasFirstCycleDiscount,
      basePlanScheduled,
      chargeCount: 0,
      cancelAtPeriodEnd: false,
      metadata: {
        authorizationUrl: razorpaySubscription.short_url,
        offerName: pricing.activeOffer?.name || pricing.limitedCampaign?.name || null,
        basePlanAmount: pricing.baseAmountPaise,
        basePlanAmountINR: pricing.baseAmountPaise / 100,
        planName: pricing.plan.name,
        billingCycle,
        couponId: pricing.coupon?.id || null,
        couponCode: pricing.coupon?.code || null,
        couponDiscountAmount: pricing.coupon?.discountAmountPaise || 0,
        couponDiscountAmountINR: pricing.coupon
          ? pricing.coupon.discountAmountPaise / 100
          : 0,
        firstCycleAmount: pricing.firstCycleAmountPaise,
        firstCycleAmountINR: pricing.firstCycleAmountPaise / 100,
        discountedPlanId,
        basePlanId: pricing.pricingEntry.razorpayPlanId,
        planIdUsed: planId,
      },
    });

    return NextResponse.json({
      subscriptionId: razorpaySubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: razorpaySubscription.short_url,
      offerApplied: pricing.hasFirstCycleDiscount,
      amount: (pricing.hasFirstCycleDiscount
        ? pricing.firstCycleAmountPaise
        : pricing.baseAmountPaise) / 100,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create subscription";
    const status = [
      "planSlug is required",
      "Invalid plan",
      "Recurring subscriptions are not available for lifetime plans",
      "Recurring plan is not configured for this billing cycle",
      "Enter a coupon code",
      "Invalid coupon code",
      "This coupon is not yet valid",
      "This coupon has expired",
      "This coupon has reached its usage limit",
      "This coupon is not valid for your account",
      "You have already used this coupon",
    ].includes(message) || message.startsWith("This coupon is only valid for:")
      ? 400
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
