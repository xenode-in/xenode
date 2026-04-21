import crypto from "crypto";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getPlanBySlugFromDB, getPricingConfig } from "@/lib/config/getPricingConfig";
import { resolveActiveCampaign } from "@/lib/pricing/pricingService";
import { PricingConfig } from "@/models/PricingConfig";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import SubscriptionOffer, { type ISubscriptionOffer } from "@/models/SubscriptionOffer";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import WebhookLog from "@/models/WebhookLog";
import Usage from "@/models/Usage";
import { User } from "@/models/User";
import {
  BASE_MONTHLY_AMOUNT_PAISE,
  SUBSCRIPTION_GRACE_PERIOD_DAYS,
  SUBSCRIPTION_PLAN_SLUG,
} from "./constants";

type UserSubscriptionStatus = "none" | "active" | "past_due" | "halted" | "cancelled";

export function computeDiscountedAmount(amount: number, discountPercent: number) {
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
    throw new Error(`PricingConfig is missing the "${SUBSCRIPTION_PLAN_SLUG}" plan`);
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

export async function getRecurringPlanContext(planSlug: string) {
  const [plan, pricing] = await Promise.all([
    getPlanBySlugFromDB(planSlug),
    getPricingConfig(),
  ]);

  if (!plan) {
    throw new Error("Invalid plan");
  }

  const monthlyEntry = plan.pricing.find((entry) => entry.cycle === "monthly");
  if (!monthlyEntry?.razorpayPlanId) {
    throw new Error("Recurring monthly plan is not configured for this plan");
  }

  const campaign = resolveActiveCampaign(pricing.campaign ?? null);
  const limitedCampaign =
    campaign &&
    campaign.discountDuration === "limited" &&
    (campaign.discountCycles ?? 0) === 1
      ? campaign
      : null;

  const baseAmountPaise = Math.round(monthlyEntry.priceINR * 100);
  const offerAmountPaise = limitedCampaign
    ? computeDiscountedAmount(baseAmountPaise, limitedCampaign.discountPercent)
    : null;

  return {
    plan,
    monthlyEntry,
    limitedCampaign,
    baseAmountPaise,
    offerAmountPaise,
  };
}

export async function createRazorpayRecurringPlan(args: {
  amountPaise: number;
  name: string;
  description?: string;
}) {
  const plan = await razorpay.plans.create({
    period: "monthly",
    interval: 1,
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

export async function updatePricingBasePlan(razorpayPlanId: string) {
  const { config } = await ensureBasePlanConfig();
  const nextPlans = config.plans.map((plan: { slug: string; pricing: unknown[] }) => {
    const plainPlan = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & {
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
  });

  await PricingConfig.updateOne(
    { _id: config._id },
    {
      $set: {
        plans: nextPlans,
      },
    },
  );
}

export function computeWebhookEventId(rawBody: string, parsedBody: unknown) {
  const parsed = parsedBody as Record<string, unknown>;
  const explicitId = typeof parsed?.["event_id"] === "string" ? parsed["event_id"] : null;
  if (explicitId) {
    return explicitId;
  }

  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export async function createWebhookLog(eventId: string, eventType: string, payload: unknown) {
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
    usageUpdate.planPriceINR = subscription?.metadata?.offerAppliedAmountINR ??
      subscription?.metadata?.basePlanAmountINR ??
      0;
    usageUpdate.basePlanPriceINR = subscription?.metadata?.basePlanAmountINR ?? 0;
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

  if (user.subscriptionStatus === "active") {
    return;
  }

  const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
  if (expiresAt) {
    const graceEndsAt = new Date(
      expiresAt.getTime() + SUBSCRIPTION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );
    if (graceEndsAt >= new Date()) {
      return;
    }
  }

  const error = new Error("Active subscription required");
  error.name = "SubscriptionRequired";
  throw error;
}

export async function createSubscriptionInvoiceIfMissing(args: {
  subscriptionId: string;
  paymentId: string;
  amountPaise: number;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  await dbConnect();
  const existing = await SubscriptionInvoice.findOne({ payment_id: args.paymentId }).lean();
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
  billingCycle?: "monthly" | "yearly" | "quarterly" | "lifetime";
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
    subscriptionEndDate: args.subscriptionEndDate || args.subscriptionStartDate || new Date(),
    method: args.method || "upi_autopay",
    notes: "subscription_charge",
    gatewayResponse: args.gatewayResponse || {},
  });

  return { payment, created: true };
}

export async function getCurrentSubscriptionForUser(userId: string) {
  await dbConnect();
  return Subscription.findOne({ userId })
    .sort({ createdAt: -1 })
    .lean();
}

export function getNextBillingAmount(subscription: {
  status?: string;
  offerApplied?: boolean;
  chargeCount?: number;
  basePlanAmount?: number;
  offerAmount?: number;
}) {
  if (subscription.offerApplied && (subscription.chargeCount ?? 0) < 1) {
    return (subscription.offerAmount ?? BASE_MONTHLY_AMOUNT_PAISE) / 100;
  }

  return (subscription.basePlanAmount ?? BASE_MONTHLY_AMOUNT_PAISE) / 100;
}

export async function createBaseFollowupSubscription(args: {
  userId: string;
  offerSubscriptionId: string;
  planSlug: string;
}) {
  const { plan, monthlyEntry, baseAmountPaise } = await getRecurringPlanContext(args.planSlug);
  const razorpaySubscription = await razorpay.subscriptions.create({
    plan_id: monthlyEntry.razorpayPlanId,
    total_count: 0,
    customer_notify: 1,
    notes: {
      userId: args.userId,
      offerSubscriptionId: args.offerSubscriptionId,
      planSlug: args.planSlug,
      kind: "base_followup",
    },
  } as never);

  const subscription = await Subscription.create({
    userId: args.userId,
    planSlug: args.planSlug,
    status: "pending",
    subscription_id: razorpaySubscription.id,
    billingCycle: "monthly",
    startDate: new Date(),
    endDate: new Date(),
    total_count: 0,
    autoRenew: true,
    gateway: "razorpay",
    offerApplied: false,
    offerSubscriptionId: args.offerSubscriptionId,
    baseSubscriptionId: razorpaySubscription.id,
    chargeCount: 0,
    cancelAtPeriodEnd: false,
    metadata: {
      authorizationUrl: razorpaySubscription.short_url,
      planName: plan.name,
      basePlanAmount: baseAmountPaise,
      basePlanAmountINR: baseAmountPaise / 100,
      kind: "base_followup",
    },
  });

  return {
    razorpaySubscription,
    subscription,
  };
}
