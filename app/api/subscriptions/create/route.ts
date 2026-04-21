import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
} from "@/lib/subscriptions/constants";
import {
  createRazorpayRecurringPlan,
  getActiveSubscriptionOffer,
  getRecurringPlanContext,
} from "@/lib/subscriptions/service";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { phone, planSlug } = await request.json().catch(() => ({
      phone: "",
      planSlug: "",
    }));

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

    const [offer, planContext] = await Promise.all([
      getActiveSubscriptionOffer(),
      getRecurringPlanContext(planSlug),
    ]);

    const fallbackOfferAmount = planContext.offerAmountPaise;
    const useStoredOffer = Boolean(
      offer &&
        offer.originalAmount === planContext.baseAmountPaise &&
        offer.discountedAmount === fallbackOfferAmount,
    );
    const isOfferActive = Boolean(useStoredOffer || fallbackOfferAmount);
    const offerPlan = !useStoredOffer && fallbackOfferAmount
      ? await createRazorpayRecurringPlan({
          amountPaise: fallbackOfferAmount,
          name: `${planContext.plan.name} - ${planContext.limitedCampaign?.name || "Offer"}`,
          description: `One-cycle discounted plan for ${planContext.plan.name}`,
        })
      : null;
    const planId = isOfferActive
      ? useStoredOffer
        ? offer!.razorpayPlanId_offer
        : offerPlan!.id
      : planContext.monthlyEntry.razorpayPlanId;
    const totalCount = isOfferActive ? 1 : 0;
    const amountPaise = isOfferActive
      ? useStoredOffer
        ? offer!.discountedAmount
        : fallbackOfferAmount!
      : planContext.baseAmountPaise;

    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: totalCount,
      customer_notify: 1,
      notes: {
        userId: session.user.id,
        planSlug: planContext.plan.slug,
        planName: planContext.plan.name,
        offerId: offer?._id?.toString?.() || "",
        phone: phone || "",
        amountPaise: String(amountPaise),
      },
    } as never);

    await Subscription.create({
      userId: session.user.id,
      planSlug: planContext.plan.slug,
      status: "created",
      subscription_id: razorpaySubscription.id,
      billingCycle: "monthly",
      startDate: new Date(),
      endDate: new Date(),
      total_count: totalCount,
      autoRenew: true,
      gateway: "razorpay",
      offerApplied: isOfferActive,
      ...(isOfferActive
        ? { offerSubscriptionId: razorpaySubscription.id }
        : { baseSubscriptionId: razorpaySubscription.id }),
      chargeCount: 0,
      cancelAtPeriodEnd: false,
      metadata: {
        authorizationUrl: razorpaySubscription.short_url,
        offerId: offer?._id?.toString?.() || null,
        offerName: offer?.name || planContext.limitedCampaign?.name || null,
        offerAmount: isOfferActive ? amountPaise : null,
        offerAppliedAmountINR: isOfferActive ? amountPaise / 100 : null,
        basePlanAmount: planContext.baseAmountPaise,
        basePlanAmountINR: planContext.baseAmountPaise / 100,
        planName: planContext.plan.name,
      },
    });

    return NextResponse.json({
      subscriptionId: razorpaySubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: razorpaySubscription.short_url,
      offerApplied: isOfferActive,
      amount: amountPaise / 100,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create subscription";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
