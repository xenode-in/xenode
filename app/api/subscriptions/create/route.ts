import { NextRequest, NextResponse } from "next/server";
import type { BillingCycle } from "@/types/pricing";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import Subscription from "@/models/Subscription";
import Coupon from "@/models/Coupon";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/subscriptions/constants";
import {
  getRecurringPlanContext,
  getActiveSubscriptionOffer,
} from "@/lib/subscriptions/service";

/**
 * POST /api/subscriptions/create
 *
 * Creates a Razorpay subscription. Discounts are handled via native offer_id:
 *
 * 1. Campaign offer (auto-applied): SubscriptionOffer.razorpayOfferId
 * 2. Coupon code (user-entered): Coupon.razorpayOfferId
 *
 * Priority: coupon > campaign offer (only one offer_id can be passed)
 */
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
      return NextResponse.json(
        { error: "planSlug is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    // ── Check for existing active subscription ──────────────────────────
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

    // ── Resolve plan and pricing ────────────────────────────────────────
    const planContext = await getRecurringPlanContext(planSlug, billingCycle);
    const baseAmountPaise = planContext.baseAmountPaise;

    // ── Resolve discount source (coupon takes priority over campaign) ───
    let offerId: string | null = null;
    let offerSource: "coupon" | "campaign" | null = null;
    let discountPercent: number | null = null;
    let couponId: string | null = null;
    let couponCodeUsed: string | null = null;

    // 1. Check for coupon code with a linked Razorpay offer
    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
      }).lean();

      if (!coupon) {
        return NextResponse.json(
          { error: "Invalid coupon code" },
          { status: 400 },
        );
      }

      const now = new Date();
      if (now < new Date(coupon.validFrom)) {
        return NextResponse.json(
          { error: "This coupon is not yet valid" },
          { status: 400 },
        );
      }
      if (now > new Date(coupon.validTo)) {
        return NextResponse.json(
          { error: "This coupon has expired" },
          { status: 400 },
        );
      }
      if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
        return NextResponse.json(
          { error: "This coupon has reached its usage limit" },
          { status: 400 },
        );
      }
      if (coupon.type === "user" && coupon.targetUserId !== session.user.id) {
        return NextResponse.json(
          { error: "This coupon is not valid for your account" },
          { status: 400 },
        );
      }
      const userUses = coupon.usedBy.filter(
        (u) => u.userId === session.user.id,
      ).length;
      if (userUses >= coupon.perUserLimit) {
        return NextResponse.json(
          { error: "You have already used this coupon" },
          { status: 400 },
        );
      }
      if (
        coupon.applicablePlans.length > 0 &&
        !coupon.applicablePlans.includes(planSlug)
      ) {
        return NextResponse.json(
          {
            error: `This coupon is only valid for: ${coupon.applicablePlans.join(", ")} plans`,
          },
          { status: 400 },
        );
      }

      if (coupon.razorpayOfferId) {
        offerId = coupon.razorpayOfferId;
        offerSource = "coupon";
        discountPercent =
          coupon.discountType === "percent" ? coupon.discountValue : null;
        couponId = coupon._id.toString();
        couponCodeUsed = coupon.code;
      } else {
        // Coupon exists but has no linked Razorpay offer_id
        return NextResponse.json(
          {
            error:
              "This coupon is not configured for subscriptions. Please contact support.",
          },
          { status: 400 },
        );
      }
    }

    // 2. Fall back to campaign offer if no coupon was applied
    if (!offerId) {
      const activeOffer = await getActiveSubscriptionOffer();
      if (activeOffer?.razorpayOfferId) {
        offerId = activeOffer.razorpayOfferId;
        offerSource = "campaign";
        discountPercent = activeOffer.discountPercent;
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

    // ── Razorpay requires total_count >= 1 ──────────────────────────────
    // Use ~30 years worth of cycles (matches Razorpay's default expire_by)
    // Do NOT pass expire_by — Razorpay defaults to 30 years automatically.
    const maxTotalCount =
      billingCycle === "yearly"
        ? 30
        : billingCycle === "quarterly"
          ? 120
          : 360; // monthly

    // ── Create the Razorpay subscription (per docs) ─────────────────────
    const subscriptionPayload: Record<string, unknown> = {
      plan_id: planContext.pricingEntry.razorpayPlanId,
      total_count: maxTotalCount,
      quantity: 1,
      customer_notify: 1,
      notes: {
        userId: session.user.id,
        planSlug: planContext.plan.slug,
        planName: planContext.plan.name,
        billingCycle,
        phone,
        couponCode: couponCodeUsed || "",
        amountPaise: String(baseAmountPaise),
      },
    };

    // Pass offer_id to Razorpay (either from coupon or campaign)
    if (offerId) {
      subscriptionPayload.offer_id = offerId;
    }

    const razorpaySubscription = await razorpay.subscriptions.create(
      subscriptionPayload as never,
    );

    // ── Save to database ────────────────────────────────────────────────
    await Subscription.create({
      userId: session.user.id,
      planSlug: planContext.plan.slug,
      status: "created",
      subscription_id: razorpaySubscription.id,
      billingCycle,
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
        billingCycle,
        razorpayPlanId: planContext.pricingEntry.razorpayPlanId,
      },
    });

    return NextResponse.json({
      subscriptionId: razorpaySubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: razorpaySubscription.short_url,
      offerApplied,
      offerSource,
      amount: (offerApplied ? firstCycleAmountPaise : baseAmountPaise) / 100,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create subscription";
    const status = [
      "planSlug is required",
      "Invalid plan",
      "Recurring subscriptions are not available for lifetime plans",
      "Recurring plan is not configured for this billing cycle",
      "Invalid coupon code",
      "This coupon is not yet valid",
      "This coupon has expired",
      "This coupon has reached its usage limit",
      "This coupon is not valid for your account",
      "You have already used this coupon",
      "This coupon is not configured for subscriptions. Please contact support.",
    ].includes(message) || message.startsWith("This coupon is only valid for:")
      ? 400
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
