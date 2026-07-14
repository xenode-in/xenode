import crypto from "crypto";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getPlanBySlugFromDB } from "@/lib/config/getPricingConfig";
import { getActiveCampaign } from "@/lib/billing/campaigns";
import type { BillingCycle } from "@/types/pricing";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import { nextSequence } from "@/models/Counter";
import WebhookLog from "@/models/WebhookLog";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import { User } from "@/models/User";
import { SUBSCRIPTION_GRACE_PERIOD_DAYS } from "./constants";

type UserSubscriptionStatus =
  | "none"
  | "active"
  | "past_due"
  | "halted"
  | "cancelled";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeDiscountedAmount(
  amount: number,
  discountPercent: number,
) {
  return Math.max(1, Math.round(amount * (1 - discountPercent / 100)));
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
  const plan = await getPlanBySlugFromDB(planSlug);

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

  const campaign = await getActiveCampaign({
    planSlug,
    cycle: billingCycle,
  });
  const limitedCampaign =
    campaign &&
    campaign.duration === "limited" &&
    (campaign.cycles ?? 0) === 1 &&
    campaign.discountPercent
      ? campaign
      : null;

  const baseAmountPaise = Math.round(pricingEntry.priceINR * 100);
  const offerAmountPaise =
    limitedCampaign && limitedCampaign.discountPercent
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

import { redeemCoupon } from "@/lib/billing/coupons";

export async function consumeCouponRedemptionIfNeeded(args: {
  couponId?: string | null;
  userId: string;
  txnid: string;
}) {
  if (!args.couponId) return false;
  return redeemCoupon({
    couponId: args.couponId,
    userId: args.userId,
    txnid: args.txnid,
  });
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
  /**
   * Set explicit grace-period state in the same atomic write. Used by halted/
   * past_due webhooks so the banner flips on without a second updateOne race.
   * If omitted, grace-period flags are cleared when expiresAt is provided.
   */
  gracePeriod?: { active: boolean; endsAt: Date | null };
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
    const planSlug = subscription?.planSlug || "free";
    usageUpdate.plan = planSlug;
    usageUpdate.planActivatedAt = subscription?.startDate || new Date();
    usageUpdate.planExpiresAt = expiresAt;
    usageUpdate.planPriceINR =
      subscription?.metadata?.offerAppliedAmountINR ??
      subscription?.metadata?.basePlanAmountINR ??
      0;
    usageUpdate.basePlanPriceINR =
      subscription?.metadata?.basePlanAmountINR ?? 0;

    // Resolve storage limit from the pricing config. Paid plans get the
    // per-plan ceiling; free / unknown plans fall back to the 5 GB default.
    // Without this, paid users stay locked at FREE_TIER_LIMIT_BYTES.
    if (planSlug && planSlug !== "free") {
      const plan = await getPlanBySlugFromDB(planSlug);
      if (plan && typeof plan.storageLimitBytes === "number") {
        usageUpdate.storageLimitBytes = plan.storageLimitBytes;
      }
    } else {
      usageUpdate.storageLimitBytes = FREE_TIER_LIMIT_BYTES;
    }
  }

  if (args.gracePeriod) {
    usageUpdate.isGracePeriod = args.gracePeriod.active;
    usageUpdate.gracePeriodEndsAt = args.gracePeriod.endsAt;
  } else if (expiresAt) {
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

  const billingDate = new Date();
  const year = billingDate.getUTCFullYear();
  const seq = await nextSequence(`invoice:${year}`);
  const number = `XEN-${year}-${String(seq).padStart(5, "0")}`;

  const invoice = await SubscriptionInvoice.create({
    number,
    subscription_id: args.subscriptionId,
    payment_id: args.paymentId,
    amount: args.amountPaise / 100,
    status: args.status || "paid",
    billing_date: billingDate,
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
 * Returns the next billing amount in INR for a subscription, or null if it
 * can't be determined from the doc. The amount lives on `metadata.basePlanAmount`
 * (paise) — pull it from the source rather than asking callers to destructure.
 *
 * Returns null instead of a hardcoded fallback so the UI can render "—" when
 * the price isn't known, instead of showing a wrong (Max-plan) number.
 */
export function getNextBillingAmount(
  subscription: { metadata?: Record<string, unknown> | null } | null,
): number | null {
  if (!subscription?.metadata) return null;
  const raw = subscription.metadata.basePlanAmount;
  const paise = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(paise) || paise <= 0) return null;
  return paise / 100;
}
