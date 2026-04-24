import crypto from "crypto";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import {
  getPlanBySlugFromDB,
  getPricingConfig,
} from "@/lib/config/getPricingConfig";
import { resolveActiveCampaign } from "@/lib/pricing/pricingService";
import type { BillingCycle } from "@/types/pricing";
import Coupon from "@/models/Coupon";
import { PricingConfig } from "@/models/PricingConfig";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import SubscriptionOffer, {
  type ISubscriptionOffer,
} from "@/models/SubscriptionOffer";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import WebhookLog from "@/models/WebhookLog";
import Usage from "@/models/Usage";
import { User } from "@/models/User";
import {
  BASE_MONTHLY_AMOUNT_PAISE,
  SUBSCRIPTION_GRACE_PERIOD_DAYS,
  SUBSCRIPTION_PLAN_SLUG,
} from "./constants";

type UserSubscriptionStatus =
  | "none"
  | "active"
  | "past_due"
  | "halted"
  | "cancelled";

interface ValidatedRecurringCoupon {
  id: string;
  code: string;
  discountAmountPaise: number;
  discountLabel: string;
}

/**
 * Pricing context for creating a recurring subscription.
 * Used by the /api/subscriptions/create route to decide whether a
 * discounted first-cycle plan is needed and whether to schedule a
 * base-plan upgrade via the Razorpay Update Subscription API.
 */
export interface RecurringFirstCyclePricing {
  plan: NonNullable<Awaited<ReturnType<typeof getPlanBySlugFromDB>>>;
  pricingEntry: {
    cycle: BillingCycle;
    priceINR: number;
    razorpayPlanId?: string;
  };
  billingCycle: BillingCycle;
  /** Full base price in paise (no discounts applied) */
  baseAmountPaise: number;
  /** Amount to charge on the first cycle (after all discounts) */
  firstCycleAmountPaise: number;
  /** Active limited campaign, if any */
  limitedCampaign: ReturnType<typeof resolveActiveCampaign> | null;
  /** Active subscription offer from the database, if any */
  activeOffer: ISubscriptionOffer | null;
  /** Validated coupon, if one was provided */
  coupon: ValidatedRecurringCoupon | null;
  /** Whether the first cycle price differs from the base price */
  hasFirstCycleDiscount: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeDiscountedAmount(
  amount: number,
  discountPercent: number,
) {
  return Math.max(1, Math.round(amount * (1 - discountPercent / 100)));
}

export async function getActiveSubscriptionOffer(now: Date = new Date()) {
  await dbConnect();
  return SubscriptionOffer.findOne({
    isActive: true,
    validFrom: { $lte: now },
    $or: [{ validUntil: null }, { validUntil: { $gte: now } }],
  })
    .sort({ createdAt: -1 })
    .lean<ISubscriptionOffer | null>();
}

export async function ensureBasePlanConfig() {
  await dbConnect();
  const pricingConfig = await PricingConfig.findOne();
  if (!pricingConfig) {
    throw new Error("Pricing configuration not found");
  }

  const planIndex = pricingConfig.plans.findIndex(
    (plan: { slug: string }) => plan.slug === SUBSCRIPTION_PLAN_SLUG,
  );
  if (planIndex === -1) {
    throw new Error(
      `PricingConfig is missing the "${SUBSCRIPTION_PLAN_SLUG}" plan`,
    );
  }

  const monthlyEntry = pricingConfig.plans[planIndex].pricing.find(
    (entry: { cycle: string }) => entry.cycle === "monthly",
  );
  if (!monthlyEntry?.razorpayPlanId) {
    throw new Error("Base monthly Razorpay plan is not configured");
  }

  return {
    config: pricingConfig,
    plan: pricingConfig.plans[planIndex],
    monthlyEntry,
  };
}

function getRazorpayPeriodConfig(cycle: BillingCycle) {
  switch (cycle) {
    case "monthly":
      return { period: "monthly", interval: 1 };
    case "quarterly":
      return { period: "monthly", interval: 3 };
    case "yearly":
      return { period: "yearly", interval: 1 };
    default:
      return null;
  }
}

// ─── Plan Context ─────────────────────────────────────────────────────────────

export async function getRecurringPlanContext(
  planSlug: string,
  billingCycle: BillingCycle,
) {
  const [plan, pricing] = await Promise.all([
    getPlanBySlugFromDB(planSlug),
    getPricingConfig(),
  ]);

  if (!plan) {
    throw new Error("Invalid plan");
  }

  if (billingCycle === "lifetime") {
    throw new Error(
      "Recurring subscriptions are not available for lifetime plans",
    );
  }

  const pricingEntry = plan.pricing.find(
    (entry) => entry.cycle === billingCycle,
  );
  if (!pricingEntry?.razorpayPlanId) {
    throw new Error("Recurring plan is not configured for this billing cycle");
  }

  const campaign = resolveActiveCampaign(pricing.campaign ?? null);
  const limitedCampaign =
    campaign &&
    campaign.discountDuration === "limited" &&
    (campaign.discountCycles ?? 0) === 1
      ? campaign
      : null;

  const baseAmountPaise = Math.round(pricingEntry.priceINR * 100);
  const offerAmountPaise = limitedCampaign
    ? computeDiscountedAmount(baseAmountPaise, limitedCampaign.discountPercent)
    : null;

  return {
    plan,
    pricingEntry,
    limitedCampaign,
    baseAmountPaise,
    offerAmountPaise,
  };
}

// ─── Coupon Validation ────────────────────────────────────────────────────────

function computeCouponDiscountPaise(args: {
  amountPaise: number;
  discountType: "percent" | "flat";
  discountValue: number;
}) {
  if (args.discountType === "percent") {
    return Math.round(args.amountPaise * (args.discountValue / 100));
  }

  return Math.min(Math.round(args.discountValue * 100), args.amountPaise - 100);
}

export async function validateRecurringCoupon(args: {
  code: string;
  userId: string;
  planSlug: string;
  amountPaise: number;
}) {
  await dbConnect();

  const normalizedCode = args.code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error("Enter a coupon code");
  }

  const coupon = await Coupon.findOne({
    code: normalizedCode,
    isActive: true,
  }).lean();

  if (!coupon) {
    throw new Error("Invalid coupon code");
  }

  const now = new Date();
  if (now < new Date(coupon.validFrom)) {
    throw new Error("This coupon is not yet valid");
  }

  if (now > new Date(coupon.validTo)) {
    throw new Error("This coupon has expired");
  }

  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    throw new Error("This coupon has reached its usage limit");
  }

  if (coupon.type === "user" && coupon.targetUserId !== args.userId) {
    throw new Error("This coupon is not valid for your account");
  }

  const userUses = coupon.usedBy.filter(
    (entry) => entry.userId === args.userId,
  ).length;
  if (userUses >= coupon.perUserLimit) {
    throw new Error("You have already used this coupon");
  }

  if (
    coupon.applicablePlans.length > 0 &&
    !coupon.applicablePlans.includes(args.planSlug)
  ) {
    throw new Error(
      `This coupon is only valid for: ${coupon.applicablePlans.join(", ")} plans`,
    );
  }

  const discountAmountPaise = computeCouponDiscountPaise({
    amountPaise: args.amountPaise,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
  });

  return {
    id: coupon._id.toString(),
    code: coupon.code,
    discountAmountPaise,
    discountLabel:
      coupon.discountType === "percent"
        ? `${coupon.discountValue}% off`
        : `Rs.${coupon.discountValue} off`,
  } satisfies ValidatedRecurringCoupon;
}

// ─── Pricing Resolution ──────────────────────────────────────────────────────

/**
 * Computes the full pricing context for creating a recurring subscription.
 * Resolves campaign offers, subscription offers, and coupon discounts
 * to determine the first-cycle amount and whether a discounted plan is needed.
 */
export async function getRecurringFirstCyclePricing(args: {
  userId: string;
  planSlug: string;
  billingCycle: BillingCycle;
  couponCode?: string | null;
}): Promise<RecurringFirstCyclePricing> {
  const [planContext, activeOffer] = await Promise.all([
    getRecurringPlanContext(args.planSlug, args.billingCycle),
    getActiveSubscriptionOffer(),
  ]);

  const campaignAdjustedAmountPaise =
    planContext.offerAmountPaise ?? planContext.baseAmountPaise;
  const coupon = args.couponCode
    ? await validateRecurringCoupon({
        code: args.couponCode,
        userId: args.userId,
        planSlug: args.planSlug,
        amountPaise: campaignAdjustedAmountPaise,
      })
    : null;

  const firstCycleAmountPaise = coupon
    ? Math.max(100, campaignAdjustedAmountPaise - coupon.discountAmountPaise)
    : campaignAdjustedAmountPaise;

  return {
    plan: planContext.plan,
    pricingEntry: {
      cycle: planContext.pricingEntry.cycle as BillingCycle,
      priceINR: planContext.pricingEntry.priceINR,
      razorpayPlanId: planContext.pricingEntry.razorpayPlanId,
    },
    billingCycle: args.billingCycle,
    baseAmountPaise: planContext.baseAmountPaise,
    firstCycleAmountPaise,
    limitedCampaign: planContext.limitedCampaign,
    activeOffer: activeOffer ?? null,
    coupon,
    hasFirstCycleDiscount:
      firstCycleAmountPaise !== planContext.baseAmountPaise,
  };
}

// ─── Razorpay Plan & Subscription Helpers ─────────────────────────────────────

export async function createRazorpayRecurringPlan(args: {
  amountPaise: number;
  name: string;
  billingCycle?: BillingCycle;
  description?: string;
}) {
  const periodConfig = getRazorpayPeriodConfig(args.billingCycle ?? "monthly");
  if (!periodConfig) {
    throw new Error("Unsupported recurring billing cycle");
  }

  const plan = await razorpay.plans.create({
    period: periodConfig.period,
    interval: periodConfig.interval,
    item: {
      name: args.name,
      amount: args.amountPaise,
      currency: "INR",
      description: args.description || args.name,
    },
    notes: {
      amountPaise: String(args.amountPaise),
    },
  } as never);

  return plan;
}

// ─── Coupon Consumption ───────────────────────────────────────────────────────

export async function consumeCouponRedemptionIfNeeded(args: {
  couponId?: string | null;
  userId: string;
  txnid: string;
}) {
  if (!args.couponId) {
    return false;
  }

  await dbConnect();

  const result = await Coupon.updateOne(
    {
      _id: args.couponId,
      "usedBy.txnid": { $ne: args.txnid },
    },
    {
      $inc: { usedCount: 1 },
      $push: {
        usedBy: {
          userId: args.userId,
          usedAt: new Date(),
          txnid: args.txnid,
        },
      },
    },
  );

  return result.modifiedCount > 0;
}

// ─── Admin Plan Management ────────────────────────────────────────────────────

export async function updatePricingBasePlan(razorpayPlanId: string) {
  const { config } = await ensureBasePlanConfig();
  const nextPlans = config.plans.map(
    (plan: { slug: string; pricing: unknown[] }) => {
      const plainPlan = JSON.parse(JSON.stringify(plan)) as Record<
        string,
        unknown
      > & {
        slug: string;
        pricing: Array<Record<string, unknown> & { cycle: string }>;
      };

      if (plainPlan.slug !== "max") {
        return plainPlan;
      }

      return {
        ...plainPlan,
        pricing: plainPlan.pricing.map((entry) =>
          entry.cycle === "monthly"
            ? {
                ...entry,
                priceINR: BASE_MONTHLY_AMOUNT_PAISE / 100,
                razorpayPlanId,
              }
            : entry,
        ),
      };
    },
  );

  await PricingConfig.updateOne(
    { _id: config._id },
    {
      $set: {
        plans: nextPlans,
      },
    },
  );
}

// ─── Webhook Helpers ──────────────────────────────────────────────────────────

export function computeWebhookEventId(rawBody: string, parsedBody: unknown) {
  const parsed = parsedBody as Record<string, unknown>;
  const explicitId =
    typeof parsed?.["event_id"] === "string" ? parsed["event_id"] : null;
  if (explicitId) {
    return explicitId;
  }

  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export async function createWebhookLog(
  eventId: string,
  eventType: string,
  payload: unknown,
) {
  await dbConnect();
  const existing = await WebhookLog.findOne({ eventId }).lean();
  if (existing) {
    return existing;
  }

  return WebhookLog.create({
    eventId,
    eventType,
    gateway: "razorpay",
    payload,
    status: "pending",
  });
}

export async function markWebhookProcessed(eventId: string) {
  await WebhookLog.updateOne(
    { eventId },
    { $set: { status: "processed", errorMessage: null } },
  );
}

export async function markWebhookFailed(eventId: string, errorMessage: string) {
  await WebhookLog.updateOne(
    { eventId },
    { $set: { status: "failed", errorMessage } },
  );
}

// ─── User State Sync ──────────────────────────────────────────────────────────

export async function syncUserSubscriptionState(args: {
  userId: string;
  subscriptionDocId?: mongoose.Types.ObjectId | string | null;
  status: UserSubscriptionStatus;
  expiresAt?: Date | null;
  autopayActive?: boolean;
}) {
  await dbConnect();

  const expiresAt = args.expiresAt ?? null;
  await User.updateOne(
    { _id: new mongoose.Types.ObjectId(args.userId) },
    {
      $set: {
        subscriptionStatus: args.status,
        subscriptionId: args.subscriptionDocId ?? null,
        subscriptionExpiresAt: expiresAt,
      },
    },
  );

  const usageUpdate: Record<string, unknown> = {
    autopayActive: args.autopayActive ?? args.status === "active",
  };

  if (expiresAt) {
    const subscription = args.subscriptionDocId
      ? await Subscription.findById(args.subscriptionDocId).lean()
      : null;
    usageUpdate.plan = subscription?.planSlug || "free";
    usageUpdate.planActivatedAt = subscription?.startDate || new Date();
    usageUpdate.planExpiresAt = expiresAt;
    usageUpdate.planPriceINR =
      subscription?.metadata?.offerAppliedAmountINR ??
      subscription?.metadata?.basePlanAmountINR ??
      0;
    usageUpdate.basePlanPriceINR =
      subscription?.metadata?.basePlanAmountINR ?? 0;
    usageUpdate.isGracePeriod = false;
    usageUpdate.gracePeriodEndsAt = null;
  }

  await Usage.findOneAndUpdate(
    { userId: args.userId },
    { $set: usageUpdate },
    { upsert: true },
  );
}

export async function enforceStorageAccess(userId: string) {
  await dbConnect();
  const user = await User.findById(userId)
    .select("subscriptionStatus subscriptionExpiresAt")
    .lean<{
      subscriptionStatus?: UserSubscriptionStatus;
      subscriptionExpiresAt?: Date | null;
    } | null>();

  if (!user) {
    const error = new Error("Unauthorized");
    error.name = "Unauthorized";
    throw error;
  }

  // Allow free tier users and users who have cancelled their premium plans to access storage
  // (Storage quotas for these users are enforced separately via the Usage model)
  if (
    !user.subscriptionStatus ||
    user.subscriptionStatus === "none" ||
    user.subscriptionStatus === "cancelled" ||
    user.subscriptionStatus === "active"
  ) {
    return;
  }

  const expiresAt = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  if (expiresAt) {
    const graceEndsAt = new Date(
      expiresAt.getTime() +
        SUBSCRIPTION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );
    if (graceEndsAt >= new Date()) {
      return;
    }
  }

  const error = new Error("Active subscription required");
  error.name = "SubscriptionRequired";
  throw error;
}

// ─── Invoice & Payment Helpers ────────────────────────────────────────────────

export async function createSubscriptionInvoiceIfMissing(args: {
  subscriptionId: string;
  paymentId: string;
  amountPaise: number;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  await dbConnect();
  const existing = await SubscriptionInvoice.findOne({
    payment_id: args.paymentId,
  }).lean();
  if (existing) {
    return { invoice: existing, created: false };
  }

  const invoice = await SubscriptionInvoice.create({
    subscription_id: args.subscriptionId,
    payment_id: args.paymentId,
    amount: args.amountPaise / 100,
    status: args.status || "paid",
    billing_date: new Date(),
    metadata: args.metadata || {},
  });

  return { invoice, created: true };
}

export async function createSubscriptionPaymentIfMissing(args: {
  userId: string;
  paymentId: string;
  subscriptionId: string;
  planName: string;
  billingCycle?: BillingCycle;
  amountPaise: number;
  subscriptionStartDate?: Date | null;
  subscriptionEndDate?: Date | null;
  method?: string;
  gatewayResponse?: Record<string, unknown>;
}) {
  await dbConnect();

  const existing = await Payment.findOne({ payment_id: args.paymentId }).lean();
  if (existing) {
    return { payment: existing, created: false };
  }

  const payment = await Payment.create({
    userId: args.userId,
    amount: args.amountPaise / 100,
    currency: "INR",
    status: "success",
    order_id: args.subscriptionId,
    payment_id: args.paymentId,
    txnid: args.paymentId,
    planName: args.planName,
    billingCycle: args.billingCycle || "monthly",
    subscriptionStartDate: args.subscriptionStartDate || new Date(),
    subscriptionEndDate:
      args.subscriptionEndDate || args.subscriptionStartDate || new Date(),
    method: args.method || "upi_autopay",
    notes: "subscription_charge",
    gatewayResponse: args.gatewayResponse || {},
  });

  return { payment, created: true };
}

// ─── Subscription Queries ─────────────────────────────────────────────────────

export async function getCurrentSubscriptionForUser(userId: string) {
  await dbConnect();
  return Subscription.findOne({ userId }).sort({ createdAt: -1 }).lean();
}

/**
 * Returns the next billing amount in INR.
 * With the single-subscription model, after the first discounted cycle
 * the Razorpay subscription has already been upgraded to the base plan,
 * so the next billing amount is always the base plan price.
 */
export function getNextBillingAmount(subscription: {
  status?: string;
  basePlanAmount?: number;
}) {
  return (subscription.basePlanAmount ?? BASE_MONTHLY_AMOUNT_PAISE) / 100;
}
