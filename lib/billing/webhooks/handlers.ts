import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import {
  consumeCouponRedemptionIfNeeded,
  createSubscriptionInvoiceIfMissing,
  createSubscriptionPaymentIfMissing,
  syncUserSubscriptionState,
} from "@/lib/subscriptions/service";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";

/**
 * Webhook event dispatcher — subscriptions only.
 *
 * One-time order events (`payment.captured`, `order.paid`) are intentionally
 * not handled: Xenode is subscription-only. They will be logged as "ignored"
 * if Razorpay ever sends them.
 *
 * All handlers MUST be idempotent — Razorpay retries on non-2xx and the admin
 * "replay" action re-dispatches the same event through here.
 */

export interface WebhookContext {
  eventId: string;
  eventType: string;
  event: any;
  source: "razorpay" | "razorpay_subscription";
}

export interface HandlerResult {
  status: "processed" | "ignored" | "failed";
  message?: string;
}

type Handler = (ctx: WebhookContext) => Promise<HandlerResult>;

// ─── Subscription helpers ─────────────────────────────────────────────────

interface SubscriptionSnapshot {
  current_period_start: Date | undefined;
  current_period_end: Date | undefined;
  paid_count: number | undefined;
}

function readSubscriptionSnapshot(entity: any): SubscriptionSnapshot {
  return {
    current_period_start:
      typeof entity?.current_start === "number"
        ? new Date(entity.current_start * 1000)
        : undefined,
    current_period_end:
      typeof entity?.current_end === "number"
        ? new Date(entity.current_end * 1000)
        : undefined,
    paid_count:
      typeof entity?.paid_count === "number" ? entity.paid_count : undefined,
  };
}

async function loadSubscription(entity: any) {
  const razorpaySubscriptionId =
    typeof entity?.id === "string" ? entity.id : null;
  if (!razorpaySubscriptionId) return null;
  await dbConnect();
  return Subscription.findOne({ subscription_id: razorpaySubscriptionId });
}

// ─── Refund handler (subscription payments are refundable via Razorpay) ───

const handleRefundProcessed: Handler = async (ctx) => {
  const refundData = ctx.event.payload?.refund?.entity;
  if (!refundData?.payment_id || !refundData?.id) {
    return { status: "ignored", message: "No refund entity" };
  }

  await dbConnect();
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await Payment.findOne({
      payment_id: refundData.payment_id,
    }).session(session);
    if (!payment) {
      await session.abortTransaction();
      return { status: "ignored", message: "Payment not found" };
    }
    if (payment.status === "refunded") {
      await session.abortTransaction();
      return { status: "processed", message: "Already refunded" };
    }

    payment.status = "refunded";
    payment.refund_id = refundData.id;
    payment.gatewayResponse = {
      ...payment.gatewayResponse,
      refundEvent: ctx.event,
    };
    await payment.save({ session });

    // Downgrade user to free immediately. The Razorpay subscription, if any,
    // should be cancelled separately by an admin or via subscription.cancelled.
    await Usage.findOneAndUpdate(
      { userId: payment.userId },
      {
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_LIMIT_BYTES,
          planExpiresAt: new Date(),
          isGracePeriod: false,
          gracePeriodEndsAt: null,
          autopayActive: false,
        },
      },
      { session },
    );

    await Subscription.findOneAndUpdate(
      { userId: payment.userId },
      { $set: { status: "cancelled" } },
      { session },
    );

    await session.commitTransaction();

    await emitBillingEvent({
      type: BillingEventType.PAYMENT_REFUNDED,
      userId: payment.userId,
      actorType: "webhook",
      actorId: ctx.eventId,
      subjectType: "payment",
      subjectId: refundData.payment_id,
      payload: {
        refundId: refundData.id,
        amount: payment.amount,
      },
    });
    return { status: "processed" };
  } catch (error: any) {
    await session.abortTransaction();
    return { status: "failed", message: error?.message ?? "Refund failed" };
  } finally {
    session.endSession();
  }
};

// ─── Subscription handlers ────────────────────────────────────────────────

const handleSubscriptionAuthenticated: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub) return { status: "ignored", message: "Subscription not found" };

  sub.status = "authenticated";
  sub.mandate_status = "approved";
  await sub.save();
  return { status: "processed" };
};

const handleSubscriptionActivated: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub) return { status: "ignored" };

  const snap = readSubscriptionSnapshot(subEntity);
  sub.status = "active";
  if (snap.current_period_start) sub.current_period_start = snap.current_period_start;
  if (snap.current_period_end) sub.current_period_end = snap.current_period_end;
  if (snap.current_period_end) sub.endDate = snap.current_period_end;
  if (snap.paid_count !== undefined) sub.paid_count = snap.paid_count;
  await sub.save();

  await syncUserSubscriptionState({
    userId: sub.userId,
    subscriptionDocId: sub._id,
    status: "active",
    expiresAt: sub.current_period_end || sub.endDate,
    autopayActive: true,
  });

  await emitBillingEvent({
    type: BillingEventType.SUBSCRIPTION_ACTIVATED,
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id ?? sub._id.toString(),
    payload: { planSlug: sub.planSlug, billingCycle: sub.billingCycle },
  });
  return { status: "processed" };
};

const handleSubscriptionCharged: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const paymentEntity = ctx.event.payload?.payment?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub || !sub.subscription_id) return { status: "ignored" };

  const amountPaise =
    typeof paymentEntity?.amount === "number"
      ? Number(paymentEntity.amount)
      : Number(sub.metadata?.basePlanAmount) || 0;

  const invoiceResult =
    typeof paymentEntity?.id === "string"
      ? await createSubscriptionInvoiceIfMissing({
          subscriptionId: sub.subscription_id,
          paymentId: paymentEntity.id,
          amountPaise,
          metadata: { eventId: ctx.eventId, source: "subscription.charged" },
        })
      : { created: false };

  const snap = readSubscriptionSnapshot(subEntity);
  sub.status = "active";
  if (snap.current_period_start) sub.current_period_start = snap.current_period_start;
  if (snap.current_period_end) sub.current_period_end = snap.current_period_end;
  if (snap.current_period_end) sub.endDate = snap.current_period_end;
  if (snap.paid_count !== undefined) sub.paid_count = snap.paid_count;

  if (invoiceResult.created) {
    sub.chargeCount = (sub.chargeCount ?? 0) + 1;
  } else if (snap.paid_count !== undefined) {
    sub.chargeCount = Math.max(sub.chargeCount ?? 0, snap.paid_count);
  }
  await sub.save();

  if (typeof paymentEntity?.id === "string") {
    await createSubscriptionPaymentIfMissing({
      userId: sub.userId,
      paymentId: paymentEntity.id,
      subscriptionId: sub.subscription_id,
      planName:
        typeof sub.metadata?.planName === "string"
          ? sub.metadata.planName
          : sub.planSlug,
      billingCycle: sub.billingCycle,
      amountPaise,
      subscriptionStartDate: sub.current_period_start || sub.startDate,
      subscriptionEndDate: sub.current_period_end || sub.endDate,
      method:
        typeof paymentEntity.method === "string"
          ? paymentEntity.method
          : "upi_autopay",
      gatewayResponse: {
        eventId: ctx.eventId,
        source: "subscription.charged",
        paymentEntity,
      },
    });

    await consumeCouponRedemptionIfNeeded({
      couponId:
        typeof sub.metadata?.couponId === "string"
          ? sub.metadata.couponId
          : null,
      userId: sub.userId,
      txnid: paymentEntity.id,
    });
  }

  await syncUserSubscriptionState({
    userId: sub.userId,
    subscriptionDocId: sub._id,
    status: "active",
    expiresAt: sub.current_period_end || sub.endDate,
    autopayActive: true,
  });

  await emitBillingEvent({
    type: BillingEventType.SUBSCRIPTION_CHARGED,
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id,
    payload: {
      amountPaise,
      paymentId: paymentEntity?.id,
      chargeCount: sub.chargeCount,
      planSlug: sub.planSlug,
    },
  });
  return { status: "processed" };
};

const setStatusAndSync = async (
  ctx: WebhookContext,
  newStatus: "past_due" | "halted" | "cancelled" | "completed" | "paused",
  userStatus: "past_due" | "halted" | "cancelled" | "active",
  eventType: string,
): Promise<HandlerResult> => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub) return { status: "ignored" };

  sub.status = newStatus;
  if (newStatus === "cancelled") {
    sub.metadata = {
      ...sub.metadata,
      cancelledAt: new Date().toISOString(),
    };
  }
  await sub.save();

  await syncUserSubscriptionState({
    userId: sub.userId,
    subscriptionDocId: sub._id,
    status: userStatus,
    expiresAt: sub.current_period_end || sub.endDate || null,
    autopayActive: userStatus === "active",
  });

  // For halted subscriptions, flip Usage to grace early so the UI banner appears
  // immediately instead of waiting for the daily cron.
  if (newStatus === "halted") {
    await Usage.updateOne(
      { userId: sub.userId, isGracePeriod: false },
      {
        $set: {
          isGracePeriod: true,
          gracePeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    );
  }

  await emitBillingEvent({
    type: eventType,
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id ?? sub._id.toString(),
    payload: { planSlug: sub.planSlug, billingCycle: sub.billingCycle },
  });
  return { status: "processed" };
};

const handleSubscriptionPending: Handler = (ctx) =>
  setStatusAndSync(ctx, "past_due", "past_due", BillingEventType.SUBSCRIPTION_PAST_DUE);

const handleSubscriptionHalted: Handler = (ctx) =>
  setStatusAndSync(ctx, "halted", "halted", BillingEventType.SUBSCRIPTION_HALTED);

const handleSubscriptionPaused: Handler = (ctx) =>
  setStatusAndSync(ctx, "paused", "active", BillingEventType.SUBSCRIPTION_PAUSED);

const handleSubscriptionResumed: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub) return { status: "ignored" };

  sub.status = "active";
  await sub.save();

  await syncUserSubscriptionState({
    userId: sub.userId,
    subscriptionDocId: sub._id,
    status: "active",
    expiresAt: sub.current_period_end || sub.endDate,
    autopayActive: true,
  });

  await emitBillingEvent({
    type: BillingEventType.SUBSCRIPTION_RESUMED,
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id ?? sub._id.toString(),
    payload: { planSlug: sub.planSlug },
  });
  return { status: "processed" };
};

const handleSubscriptionCancelled: Handler = (ctx) =>
  setStatusAndSync(ctx, "cancelled", "cancelled", BillingEventType.SUBSCRIPTION_CANCELLED);

/**
 * `subscription.updated` fires when plan / quantity / remaining_count change
 * (e.g. our change-plan endpoint, or admin tweak in the Razorpay dashboard).
 * Refresh our local Subscription doc from the webhook payload's subscription
 * entity. Idempotent — calling repeatedly is a no-op when state already matches.
 *
 * https://razorpay.com/docs/webhooks/payloads/subscriptions/
 */
const handleSubscriptionUpdated: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub) return { status: "ignored" };

  const snap = readSubscriptionSnapshot(subEntity);
  if (snap.current_period_start) sub.current_period_start = snap.current_period_start;
  if (snap.current_period_end) {
    sub.current_period_end = snap.current_period_end;
    sub.endDate = snap.current_period_end;
  }
  if (snap.paid_count !== undefined) sub.paid_count = snap.paid_count;

  // Pull the new plan_id forward so our local planSlug stays in sync when an
  // immediate change applied. Slug isn't on the entity — we keep whatever was
  // already on the doc (set by /change-plan in immediate mode).
  if (typeof subEntity?.plan_id === "string") {
    sub.metadata = {
      ...sub.metadata,
      razorpayPlanId: subEntity.plan_id,
      lastUpdatedFromWebhook: new Date().toISOString(),
    };
  }
  await sub.save();

  await emitBillingEvent({
    type: "subscription.updated",
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id ?? sub._id.toString(),
    payload: {
      planSlug: sub.planSlug,
      razorpayPlanId: subEntity?.plan_id ?? null,
      quantity: subEntity?.quantity ?? null,
      remainingCount: subEntity?.remaining_count ?? null,
    },
  });
  return { status: "processed" };
};

const handleSubscriptionCompleted: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  if (!sub) return { status: "ignored" };
  sub.status = "completed";
  await sub.save();

  await emitBillingEvent({
    type: BillingEventType.SUBSCRIPTION_COMPLETED,
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id ?? sub._id.toString(),
    payload: {},
  });
  return { status: "processed" };
};

const handlePaymentFailed: Handler = async (ctx) => {
  const failedData = ctx.event.payload?.payment?.entity;
  if (!failedData?.id) return { status: "ignored" };

  // Subscription auto-charge failure. The matching subscription.halted or
  // subscription.pending event will downgrade state — here we only audit.
  await emitBillingEvent({
    type: BillingEventType.PAYMENT_FAILED,
    userId: null,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "payment",
    subjectId: failedData.id,
    payload: {
      reason: failedData.error_description,
      code: failedData.error_code,
      subscriptionId: failedData.subscription_id ?? null,
    },
  });
  return { status: "processed" };
};

const handleDispute: Handler = async (ctx) => {
  const disputeEntity = ctx.event.payload?.dispute?.entity;
  await emitBillingEvent({
    type: BillingEventType.PAYMENT_DISPUTE_CREATED,
    userId: null,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "payment",
    subjectId: disputeEntity?.payment_id ?? null,
    payload: {
      disputeId: disputeEntity?.id,
      amount: disputeEntity?.amount,
      reasonCode: disputeEntity?.reason_code,
      phase: disputeEntity?.phase,
    },
  });
  return { status: "processed" };
};

// ─── Registry ─────────────────────────────────────────────────────────────

const REGISTRY: Record<string, Handler> = {
  "payment.failed": handlePaymentFailed,
  "refund.processed": handleRefundProcessed,

  "subscription.authenticated": handleSubscriptionAuthenticated,
  "subscription.activated": handleSubscriptionActivated,
  "subscription.charged": handleSubscriptionCharged,
  "subscription.pending": handleSubscriptionPending,
  "subscription.halted": handleSubscriptionHalted,
  "subscription.paused": handleSubscriptionPaused,
  "subscription.resumed": handleSubscriptionResumed,
  "subscription.cancelled": handleSubscriptionCancelled,
  "subscription.completed": handleSubscriptionCompleted,
  "subscription.updated": handleSubscriptionUpdated,

  "payment.dispute.created": handleDispute,
  "payment.dispute.lost": handleDispute,
  "payment.dispute.won": handleDispute,
};

export async function dispatchWebhookEvent(
  ctx: WebhookContext,
): Promise<HandlerResult> {
  const handler = REGISTRY[ctx.eventType];
  if (!handler) {
    return { status: "ignored", message: `Unhandled event: ${ctx.eventType}` };
  }
  return handler(ctx);
}

export function isKnownEventType(eventType: string): boolean {
  return eventType in REGISTRY;
}
