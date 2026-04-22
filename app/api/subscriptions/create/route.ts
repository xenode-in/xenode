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

    const pricing = await getRecurringFirstCyclePricing({
      userId: session.user.id,
      planSlug,
      billingCycle,
      couponCode: couponCode || null,
    });

    const offerPlan =
      pricing.requiresOfferSubscription && !pricing.activeOffer
        ? await createRazorpayRecurringPlan({
            amountPaise: pricing.firstCycleAmountPaise,
            name: `${pricing.plan.name} - Intro ${billingCycle}`,
            billingCycle,
            description: `One-cycle introductory plan for ${pricing.plan.name}`,
          })
        : null;

    const planId = pricing.requiresOfferSubscription
      ? pricing.activeOffer
        ? pricing.activeOffer.razorpayPlanId_offer
        : offerPlan!.id
      : pricing.pricingEntry.razorpayPlanId;
    const totalCount = pricing.requiresOfferSubscription ? 1 : 0;
    const amountPaise = pricing.requiresOfferSubscription
      ? pricing.firstCycleAmountPaise
      : pricing.baseAmountPaise;

    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: totalCount,
      customer_notify: 1,
      notes: {
        userId: session.user.id,
        planSlug: pricing.plan.slug,
        planName: pricing.plan.name,
        billingCycle,
        offerId: pricing.activeOffer?._id?.toString?.() || "",
        couponCode: pricing.coupon?.code || "",
        phone,
        amountPaise: String(amountPaise),
      },
    } as never);

    await Subscription.create({
      userId: session.user.id,
      planSlug: pricing.plan.slug,
      status: "created",
      subscription_id: razorpaySubscription.id,
      billingCycle,
      startDate: new Date(),
      endDate: new Date(),
      total_count: totalCount,
      autoRenew: true,
      gateway: "razorpay",
      offerApplied: pricing.requiresOfferSubscription,
      ...(pricing.requiresOfferSubscription
        ? { offerSubscriptionId: razorpaySubscription.id }
        : { baseSubscriptionId: razorpaySubscription.id }),
      chargeCount: 0,
      cancelAtPeriodEnd: false,
      metadata: {
        authorizationUrl: razorpaySubscription.short_url,
        offerId: pricing.activeOffer?._id?.toString?.() || null,
        offerName: pricing.activeOffer?.name || pricing.limitedCampaign?.name || null,
        offerAmount: pricing.requiresOfferSubscription ? amountPaise : null,
        offerAppliedAmountINR: pricing.requiresOfferSubscription ? amountPaise / 100 : null,
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
        planIdUsed: planId,
      },
    });

    return NextResponse.json({
      subscriptionId: razorpaySubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: razorpaySubscription.short_url,
      offerApplied: pricing.requiresOfferSubscription,
      amount: amountPaise / 100,
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
