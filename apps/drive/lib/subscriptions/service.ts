import crypto from "crypto";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import { getPlanBySlugFromDB } from "@/lib/config/getPricingConfig";
import { getActiveCampaign } from "@/lib/billing/campaigns";
import type { BillingCurrency, BillingCycle } from "@/types/pricing";
import {
  DEFAULT_STORAGE_REGION,
  type StorageRegion,
} from "@xenode/config/storage";
import { resolveRegionPricing, toMinorUnits } from "@/lib/pricing/regionPricing";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import { nextSequence } from "@/models/Counter";
import WebhookLog from "@/models/WebhookLog";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import { User } from "@/models/User";
import { getDatabase, possibleUserIds, withTransaction } from "@xenode/database";
import { BillingError } from "@/lib/billing/http";
import { emitBillingEvent, type EmitArgs } from "@/lib/billing/events";
import { SUBSCRIPTION_GRACE_PERIOD_DAYS, SUBSCRIPTION_GRACE_PERIOD_MS } from "./constants";

export type UserSubscriptionStatus =
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
  region: StorageRegion = DEFAULT_STORAGE_REGION,
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
  if (!pricingEntry) {
    throw new Error("Recurring plan is not configured for this billing cycle");
  }

  // Resolve the caller's region price + currency + region-specific Razorpay plan.
  const regionPrice = resolveRegionPricing(pricingEntry, region);
  if (!regionPrice.razorpayPlanId) {
    throw new Error(
      `Recurring plan is not configured for ${region}/${regionPrice.currency}`,
    );
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

  // "Paise" is the historical name; for USD/EUR these are cents (same ×100).
  const baseAmountPaise = toMinorUnits(regionPrice.amount);
  const offerAmountPaise =
    limitedCampaign && limitedCampaign.discountPercent
      ? computeDiscountedAmount(baseAmountPaise, limitedCampaign.discountPercent)
      : null;

  return {
    plan,
    pricingEntry,
    region,
    currency: regionPrice.currency,
    razorpayPlanId: regionPrice.razorpayPlanId,
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
  currency?: BillingCurrency;
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
      currency: args.currency ?? "INR",
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

export type PersonalPlanOverride = {
  plan?: "free" | "basic" | "pro" | "plus" | "max" | "enterprise";
  planExpiresAt?: Date | null;
  storageLimitBytes?: number | null;
  egressLimitBytes?: number;
};

type UserStateCommand = {
  userId: string;
  session?: mongoose.ClientSession;
  actor?: Pick<EmitArgs, "actorType" | "actorId">;
} & (
  | { action?: "subscription"; subscriptionDocId?: mongoose.Types.ObjectId | string | null;
      status: UserSubscriptionStatus; expiresAt?: Date | null; autopayActive?: boolean;
      gracePeriod?: { active: boolean; endsAt: Date | null };
      renewal?: { invoiceId: mongoose.Types.ObjectId | string } }
  | { action: "initialize" }
  | { action: "admin"; override: PersonalPlanOverride }
  | { action: "expire"; now: Date }
  | { action: "refund"; subscriptionDocId: mongoose.Types.ObjectId | string }
);

function freeEntitlement() {
  return {
    subscriptionDocId: null, plan: "free", storageLimitBytes: FREE_TIER_LIMIT_BYTES,
    planActivatedAt: null, planExpiresAt: null, planPriceINR: 0, basePlanPriceINR: 0,
    campaignType: null, campaignCyclesLeft: null, isGracePeriod: false,
    gracePeriodEndsAt: null, autopayActive: false, autopayMandateId: null, lastRenewalTxnid: null,
  };
}

/**
 * Accounts onboarding runs before the first Drive visit and does not touch
 * billing, so Drive creates the account's storage entitlement (free, or paid
 * from an owned subscription) when it is missing. A cheap existence check
 * keeps repeat visits off the transactional writer.
 */
export async function ensureUserUsage(userId: string) {
  await dbConnect();
  if (await Usage.exists({ userId })) return;
  await syncUserSubscriptionState({
    userId, action: "initialize", actor: { actorType: "user", actorId: userId },
  });
}

/** Sole Usage entitlement writer. State, identity projection and audit commit together. */
export async function syncUserSubscriptionState(args: UserStateCommand) {
  await dbConnect();
  await Promise.all([Usage.init(), SubscriptionInvoice.init()]);
  const apply = async (session: mongoose.ClientSession) => {
    const current = await Usage.findOne({ userId: args.userId }).session(session);
    if (args.action === "initialize" && current) return { usage: current, outcome: "unchanged" as const };
    if (args.action === "expire" && (!current || current.plan === "free" ||
      !current.planExpiresAt || current.planExpiresAt > args.now)) {
      return { usage: current, outcome: "unchanged" as const };
    }

    let subscription = "subscriptionDocId" in args && args.subscriptionDocId
      ? await Subscription.findById(args.subscriptionDocId).session(session)
      : null;
    if (args.action === "initialize") {
      subscription = await Subscription.findOne({
        userId: args.userId, accountId: { $in: [null, args.userId] },
        status: { $in: ["active", "paused", "past_due", "halted", "cancelled"] },
        "metadata.entitlementRevokedAt": { $exists: false },
      }).sort({ createdAt: -1, _id: -1 }).session(session);
    }
    if (subscription && (subscription.userId !== args.userId ||
      (subscription.accountId && subscription.accountId !== args.userId))) {
      throw new BillingError(409, "Subscription belongs to a different billing account", "subscription_scope");
    }
    if ("subscriptionDocId" in args && args.subscriptionDocId && !subscription) {
      throw new BillingError(404, "Subscription not found", "subscription_missing");
    }
    if (args.action === "refund" && String(current?.subscriptionDocId) !== String(subscription?._id)) {
      return { usage: current, outcome: "unchanged" as const };
    }
    if ((args.action === undefined || args.action === "subscription") && subscription) {
      if (subscription.metadata?.entitlementRevokedAt) return { usage: current, outcome: "unchanged" as const };
      if (current?.manualPlanAssignedAt && subscription.createdAt <= current.manualPlanAssignedAt) {
        return { usage: current, outcome: "unchanged" as const };
      }
      if (current?.subscriptionDocId && String(current.subscriptionDocId) !== String(subscription._id)) {
        const bound = await Subscription.findById(current.subscriptionDocId).session(session);
        if (bound && (bound.createdAt > subscription.createdAt ||
          (bound.createdAt.getTime() === subscription.createdAt.getTime() && String(bound._id) > String(subscription._id)))) {
          return { usage: current, outcome: "unchanged" as const };
        }
      }
      if (args.renewal) {
        const invoice = await SubscriptionInvoice.findById(args.renewal.invoiceId).session(session);
        if (!invoice || invoice.subscription_id !== subscription.subscription_id) {
          throw new BillingError(409, "Renewal invoice belongs to a different subscription", "invoice_scope");
        }
        if (invoice.usageAppliedAt) return { usage: current, outcome: "unchanged" as const };
      }
    }

    let outcome = "synced";
    let status: UserSubscriptionStatus = "none";
    let update: Record<string, unknown> = {};
    if (args.action === "expire") {
      const usage = current!;
      const graceEndsAt = usage.isGracePeriod && usage.gracePeriodEndsAt
        ? usage.gracePeriodEndsAt
        : new Date(usage.planExpiresAt!.getTime() + SUBSCRIPTION_GRACE_PERIOD_MS);
      if (graceEndsAt > args.now) {
        update = { isGracePeriod: true, gracePeriodEndsAt: graceEndsAt };
        status = "past_due";
        outcome = "grace";
      } else {
        update = freeEntitlement();
        status = "cancelled";
        outcome = "expired";
        await Subscription.updateMany({
          userId: args.userId, accountId: { $in: [null, args.userId] },
          status: { $in: ["active", "paused", "pending", "past_due", "halted"] },
          endDate: { $lte: usage.planExpiresAt },
        }, { $set: { status: "expired", autoRenew: false } }, { session });
      }
    } else if (args.action === "refund") {
      update = freeEntitlement();
      status = "cancelled";
      outcome = "refunded";
    } else if (args.action === "admin") {
      const { override } = args;
      const identity = await getDatabase().collection<{ _id: string | mongoose.mongo.ObjectId; id?: string;
        subscriptionStatus?: UserSubscriptionStatus }>("user").findOne(
        { $or: [{ _id: { $in: possibleUserIds(args.userId) } }, { id: args.userId }] }, { session });
      if (!identity) throw new BillingError(404, "User not found", "user_missing");
      if (override.plan !== undefined || override.planExpiresAt !== undefined) {
        const bound = await Subscription.findOne({ userId: args.userId, accountId: { $in: [null, args.userId] },
          status: { $in: ["authenticated", "active", "paused", "pending", "past_due", "halted"] } }).session(session);
        if (bound) {
          throw new BillingError(409, "Manage the live subscription before assigning a manual plan", "subscription_active");
        }
      }
      if (override.plan !== undefined) {
        if (override.plan === "free") update = freeEntitlement();
        else {
          const plan = await getPlanBySlugFromDB(override.plan);
          if (!plan) throw new BillingError(400, "Plan is not configured", "invalid_plan");
          update = { ...freeEntitlement(), plan: override.plan, storageLimitBytes: plan.storageLimitBytes,
            planActivatedAt: new Date(), planExpiresAt: override.planExpiresAt ?? null };
        }
        update.manualPlanAssignedAt = new Date();
      }
      if (override.planExpiresAt !== undefined) update.planExpiresAt = override.planExpiresAt;
      if (override.storageLimitBytes !== undefined) update.storageLimitBytes = override.storageLimitBytes;
      if (override.egressLimitBytes !== undefined) update.egressLimitBytes = override.egressLimitBytes;
      if (!Object.keys(update).length) throw new BillingError(400, "No valid fields to update", "invalid_request");
      status = override.plan !== undefined
        ? override.plan === "free" ? "none" : "active"
        : identity.subscriptionStatus ?? ((current?.plan ?? "free") === "free" ? "none" : "active");
    } else {
      const initialization = args.action === "initialize";
      status = initialization
        ? subscription ? subscription.status === "cancelled" ? "cancelled" : subscription.status === "halted"
          ? "halted" : subscription.status === "past_due" ? "past_due" : "active" : "none"
        : args.status;
      const expiresAt = initialization ? subscription?.current_period_end ?? subscription?.endDate ?? null : args.expiresAt ?? null;
      if (subscription && expiresAt) {
        const plan = await getPlanBySlugFromDB(subscription.planSlug);
        if (!plan) throw new BillingError(409, "Subscription plan is not configured", "invalid_plan");
        update = { subscriptionDocId: subscription._id, manualPlanAssignedAt: null, plan: subscription.planSlug,
          storageLimitBytes: plan.storageLimitBytes, planActivatedAt: subscription.startDate,
          planExpiresAt: expiresAt, planPriceINR: subscription.metadata?.offerAppliedAmountINR ??
            subscription.metadata?.basePlanAmountINR ?? 0,
          basePlanPriceINR: subscription.metadata?.basePlanAmountINR ?? 0,
          autopayActive: initialization ? subscription.autoRenew && status === "active" : args.autopayActive ?? status === "active",
          isGracePeriod: false, gracePeriodEndsAt: null };
      } else if (initialization || status === "none" || status === "cancelled") {
        update = freeEntitlement();
      } else {
        throw new BillingError(409, "Paid state requires a subscription and period", "subscription_missing");
      }
      if (!initialization && args.gracePeriod) {
        update.isGracePeriod = args.gracePeriod.active;
        update.gracePeriodEndsAt = args.gracePeriod.active && current?.isGracePeriod &&
          current.gracePeriodEndsAt && current.planExpiresAt?.getTime() === expiresAt?.getTime()
          ? current.gracePeriodEndsAt : args.gracePeriod.endsAt;
      }
      if (!initialization && args.renewal) {
        const invoice = await SubscriptionInvoice.findById(args.renewal.invoiceId).session(session);
        if (!invoice || invoice.subscription_id !== subscription?.subscription_id) {
          throw new BillingError(409, "Renewal invoice belongs to a different subscription", "invoice_scope");
        }
        if (!invoice.usageAppliedAt) {
          update.lastRenewalTxnid = invoice.payment_id;
          if (current?.campaignType === "limited") {
            const cycles = Math.max(0, (current.campaignCyclesLeft ?? 0) - 1);
            update.campaignType = cycles ? "limited" : null;
            update.campaignCyclesLeft = cycles || null;
          }
          invoice.usageAppliedAt = new Date();
          await invoice.save({ session });
        }
      }
      if (initialization) outcome = "initialized";
    }

    const before = current?.toObject() as Record<string, unknown> | undefined;
    const changed = Object.entries(update).some(([key, value]) => JSON.stringify(before?.[key]) !== JSON.stringify(value));
    const usage = await Usage.findOneAndUpdate({ userId: args.userId }, { $set: update },
      { upsert: true, new: true, runValidators: true, session });
    const projectedSubscriptionId = "subscriptionDocId" in update ? update.subscriptionDocId : usage.subscriptionDocId;
    const projection = await getDatabase().collection<{ _id: string | mongoose.mongo.ObjectId; id?: string }>("user").updateOne(
      { $or: [{ _id: { $in: possibleUserIds(args.userId) } }, { id: args.userId }] },
      { $set: { subscriptionStatus: status, subscriptionId: projectedSubscriptionId,
        subscriptionExpiresAt: usage.planExpiresAt } }, { session });
    if (changed || projection.modifiedCount) await emitBillingEvent({
      type: "usage.entitlement.changed", userId: args.userId,
      actorType: args.actor?.actorType ?? "system", actorId: args.actor?.actorId ?? null,
      subjectType: "usage", subjectId: args.userId,
      payload: { action: args.action ?? "subscription", outcome, previousPlan: current?.plan ?? null,
        plan: usage.plan, status, storageLimitBytes: usage.storageLimitBytes, expiresAt: usage.planExpiresAt },
    }, session);
    return { usage, outcome };
  };
  return args.session ? apply(args.session) : withTransaction(apply);
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
  accountId?: string | null;
  paymentId: string;
  subscriptionId: string;
  planName: string;
  billingCycle?: BillingCycle;
  amountPaise: number;
  currency?: BillingCurrency;
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
    accountId: args.accountId ?? args.userId,
    amount: args.amountPaise / 100,
    currency: args.currency ?? "INR",
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
