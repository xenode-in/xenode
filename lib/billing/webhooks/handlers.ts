import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import RefundRequest from "@/models/RefundRequest";
import SupportTicket from "@/models/SupportTicket";
import { User } from "@/models/User";
import {
  consumeCouponRedemptionIfNeeded,
  createSubscriptionInvoiceIfMissing,
  createSubscriptionPaymentIfMissing,
  syncUserSubscriptionState,
} from "@/lib/subscriptions/service";
import { SUBSCRIPTION_GRACE_PERIOD_MS } from "@/lib/subscriptions/constants";
import { getPlanByRazorpayPlanIdFromDB } from "@/lib/config/getPricingConfig";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";
import { findRefundRequestForWebhook } from "@/lib/refunds/processor";
import { addReply } from "@/lib/support/tickets";
import { notifyRefundCompleted } from "@/lib/email/notifications";

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

  // Atomic upsert: if the doc already exists return it as-is; if not, create
  // it from the Razorpay webhook payload notes. This handles the case where
  // the user paid but the browser crashed before /verify was called.
  const notes = ((entity.notes as Record<string, string>) || {});
  const baseAmount = Number(notes.basePlanAmount) || 0;
  const firstCycleAmount = Number(notes.firstCycleAmount) || baseAmount;

  return Subscription.findOneAndUpdate(
    { subscription_id: razorpaySubscriptionId },
    {
      $setOnInsert: {
        userId: notes.userId || null,
        planSlug: notes.planSlug || null,
        status: "created",
        subscription_id: razorpaySubscriptionId,
        billingCycle: notes.billingCycle || "monthly",
        startDate: new Date(),
        endDate: new Date(),
        total_count: entity.total_count ?? 360,
        autoRenew: true,
        gateway: "razorpay",
        offerApplied: notes.offerApplied === "true",
        chargeCount: 0,
        paid_count: 0,
        cancelAtPeriodEnd: false,
        metadata: {
          authorizationUrl: entity.short_url ?? null,
          offerSource: notes.offerSource || null,
          offerId: notes.offerId || null,
          discountPercent: notes.discountPercent ? Number(notes.discountPercent) : null,
          couponId: notes.couponId || null,
          couponCode: notes.couponCode || null,
          basePlanAmount: baseAmount,
          basePlanAmountINR: Number(notes.basePlanAmountINR) || 0,
          firstCycleAmount,
          firstCycleAmountINR: Number(notes.firstCycleAmountINR) || 0,
          planName: notes.planName || notes.planSlug || "",
          billingCycle: notes.billingCycle || "monthly",
          razorpayPlanId: notes.razorpayPlanId || "",
        },
      },
    },
    { upsert: true, new: true },
  );
}

// ─── Refund handlers (subscription payments are refundable via Razorpay) ──

/**
 * `refund.created` — Razorpay accepted the refund and is processing it.
 *
 * We don't downgrade the user here; we wait for `refund.processed` to confirm
 * the money actually moved. This handler updates RefundRequest.status to
 * "processing" so the admin UI reflects reality.
 */
const handleRefundCreated: Handler = async (ctx) => {
  const refundData = ctx.event.payload?.refund?.entity;
  if (!refundData?.id || !refundData?.payment_id) {
    return { status: "ignored", message: "No refund entity" };
  }

  await dbConnect();

  const refundRequest = await findRefundRequestForWebhook({
    razorpayRefundId: refundData.id,
    razorpayPaymentId: refundData.payment_id,
  });

  if (refundRequest && refundRequest.status !== "completed") {
    refundRequest.razorpayRefundId =
      refundRequest.razorpayRefundId ?? refundData.id;
    if (refundRequest.status === "approved" || refundRequest.status === "pending") {
      refundRequest.status = "processing";
    }
    await refundRequest.save();
  }

  // Always update Payment row so the user's billing page reflects the in-flight
  // refund even when the request was initiated outside our system (Razorpay
  // dashboard).
  await Payment.updateOne(
    { payment_id: refundData.payment_id, status: { $ne: "refunded" } },
    {
      $set: {
        status: "refund_initiated",
        refund_id: refundData.id,
        refund_status: "processing",
      },
    },
  );

  await emitBillingEvent({
    type: "refund.created",
    userId: refundRequest?.userId ?? null,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "refund",
    subjectId: refundRequest ? String(refundRequest._id) : refundData.id,
    payload: {
      refundId: refundData.id,
      paymentId: refundData.payment_id,
      amount: refundData.amount,
    },
  });

  return { status: "processed" };
};

/**
 * `refund.failed` — Razorpay tried to refund but the upstream bank rejected.
 *
 * Roll Payment back to "success" so it doesn't appear stuck, and mark the
 * RefundRequest as "failed" so admins can retry or escalate.
 */
const handleRefundFailed: Handler = async (ctx) => {
  const refundData = ctx.event.payload?.refund?.entity;
  if (!refundData?.id || !refundData?.payment_id) {
    return { status: "ignored", message: "No refund entity" };
  }

  await dbConnect();

  const refundRequest = await findRefundRequestForWebhook({
    razorpayRefundId: refundData.id,
    razorpayPaymentId: refundData.payment_id,
  });

  if (refundRequest && refundRequest.status !== "completed") {
    refundRequest.status = "failed";
    refundRequest.failureReason =
      refundData.error_description || refundData.status_reason || "Refund failed at gateway";
    await refundRequest.save();
  }

  await Payment.updateOne(
    { payment_id: refundData.payment_id, status: { $in: ["refund_initiated", "refund_pending"] } },
    {
      $set: {
        status: "success",
        refund_status: "failed",
      },
    },
  );

  await emitBillingEvent({
    type: "refund.failed",
    userId: refundRequest?.userId ?? null,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "refund",
    subjectId: refundRequest ? String(refundRequest._id) : refundData.id,
    payload: {
      refundId: refundData.id,
      paymentId: refundData.payment_id,
      reason: refundData.error_description || refundData.status_reason,
    },
  });

  return { status: "processed" };
};

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
    payment.refund_status = "processed";
    payment.gatewayResponse = {
      ...payment.gatewayResponse,
      refundEvent: ctx.event,
    };
    await payment.save({ session });

    // Downgrade user to free immediately. The Razorpay subscription, if any,
    // should be cancelled separately by an admin or via subscription.cancelled.
    // Field set matches /api/cron/expire-plans so a refunded user looks
    // identical to a naturally-lapsed one.
    await Usage.findOneAndUpdate(
      { userId: payment.userId },
      {
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_LIMIT_BYTES,
          planExpiresAt: new Date(),
          planPriceINR: 0,
          basePlanPriceINR: 0,
          campaignType: null,
          campaignCyclesLeft: null,
          isGracePeriod: false,
          gracePeriodEndsAt: null,
          autopayActive: false,
          lastRenewalTxnid: null,
        },
      },
      { session },
    );

    await Subscription.findOneAndUpdate(
      { userId: payment.userId },
      { $set: { status: "cancelled" } },
      { session },
    );

    // Find the matching RefundRequest (if any) and mark completed. This is
    // outside the transaction because RefundRequest writes don't share state
    // with the Payment/Usage/Subscription consistency requirement.
    await session.commitTransaction();

    const refundRequest = await findRefundRequestForWebhook({
      razorpayRefundId: refundData.id,
      razorpayPaymentId: refundData.payment_id,
    });

    if (refundRequest && refundRequest.status !== "completed") {
      refundRequest.status = "completed";
      refundRequest.razorpayRefundId = refundData.id;
      refundRequest.refundedAt = new Date();
      await refundRequest.save();

      // Post a final system reply on the ticket + notify the user.
      const ticket = await SupportTicket.findById(refundRequest.ticketId);
      if (ticket) {
        if (ticket.status !== "closed") {
          await addReply({
            ticketId: String(ticket._id),
            authorType: "system",
            authorId: "system",
            authorName: "Xenode Refunds",
            message: `Refund of ${refundRequest.currency} ${refundRequest.amount.toFixed(2)} has settled. Your account has been moved to the free plan.`,
            isInternal: false,
          });
          // Auto-resolve the ticket — user can still reply to reopen.
          ticket.status = "resolved";
          ticket.resolvedAt = new Date();
          ticket.resolvedBy = "system";
          await ticket.save();
        }

        await notifyRefundCompleted({
          userEmail: ticket.userEmail,
          userName: ticket.userName,
          amount: refundRequest.amount,
          currency: refundRequest.currency,
          ticketId: String(ticket._id),
        });
      } else {
        // Best-effort: email the user directly using User collection.
        const user = await User.findById(payment.userId).lean();
        if (user?.email) {
          await notifyRefundCompleted({
            userEmail: user.email,
            userName: user.name || user.email,
            amount: payment.amount,
            currency: payment.currency,
            ticketId: String(refundRequest._id),
          });
        }
      }
    }

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
        refundRequestId: refundRequest ? String(refundRequest._id) : null,
      },
    });
    return { status: "processed" };
  } catch (error: any) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
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

  // Decrement limited-campaign cycle counter and record the renewal txnid.
  // Guarded on invoiceResult.created so webhook replay doesn't double-count.
  if (invoiceResult.created) {
    const txnidUpdate: Record<string, unknown> = {};
    if (typeof paymentEntity?.id === "string") {
      txnidUpdate.lastRenewalTxnid = paymentEntity.id;
    }

    // Atomic decrement only when cycles remain. If this drops to zero,
    // the next charge's findOneAndUpdate clears the campaign (see below).
    await Usage.findOneAndUpdate(
      {
        userId: sub.userId,
        campaignType: "limited",
        campaignCyclesLeft: { $gt: 0 },
      },
      {
        $inc: { campaignCyclesLeft: -1 },
        ...(Object.keys(txnidUpdate).length ? { $set: txnidUpdate } : {}),
      },
    );

    // Clear the campaign once it's fully consumed.
    await Usage.updateOne(
      {
        userId: sub.userId,
        campaignType: "limited",
        campaignCyclesLeft: { $lte: 0 },
      },
      { $set: { campaignType: null, campaignCyclesLeft: null } },
    );

    // Fallback for users without an active campaign — still record the txnid.
    if (Object.keys(txnidUpdate).length) {
      await Usage.updateOne(
        { userId: sub.userId, campaignType: { $ne: "limited" } },
        { $set: txnidUpdate },
      );
    }
  }

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

  // For halted subscriptions, flip Usage to grace in the same atomic write so
  // the UI banner appears immediately and there's no window where the user is
  // halted-without-grace.
  const gracePeriod =
    newStatus === "halted"
      ? {
          active: true,
          endsAt: new Date(Date.now() + SUBSCRIPTION_GRACE_PERIOD_MS),
        }
      : undefined;

  await syncUserSubscriptionState({
    userId: sub.userId,
    subscriptionDocId: sub._id,
    status: userStatus,
    expiresAt: sub.current_period_end || sub.endDate || null,
    autopayActive: userStatus === "active",
    gracePeriod,
  });

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
 * Two paths apply the new plan locally:
 *   1. `metadata.scheduledChange` set by /change-plan in period_end mode — when
 *      the entity's plan_id matches the scheduled Razorpay plan id, we promote
 *      its newPlanSlug/newBillingCycle into the Subscription doc.
 *   2. Razorpay-dashboard or out-of-band plan swaps — we reverse-lookup the
 *      plan_id in PricingConfig and apply.
 *
 * After either path, syncUserSubscriptionState updates Usage so storage limits
 * track the new plan immediately.
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

  const incomingPlanId =
    typeof subEntity?.plan_id === "string" ? subEntity.plan_id : null;
  const previousRazorpayPlanId =
    typeof sub.metadata?.razorpayPlanId === "string"
      ? sub.metadata.razorpayPlanId
      : null;
  const planIdChanged =
    incomingPlanId !== null && incomingPlanId !== previousRazorpayPlanId;

  let planApplied = false;
  if (planIdChanged && incomingPlanId) {
    const scheduled = (sub.metadata?.scheduledChange ?? null) as {
      newPlanSlug?: string;
      newBillingCycle?: string;
      newRazorpayPlanId?: string;
    } | null;

    if (
      scheduled &&
      scheduled.newRazorpayPlanId === incomingPlanId &&
      scheduled.newPlanSlug
    ) {
      sub.planSlug = scheduled.newPlanSlug;
      if (scheduled.newBillingCycle) {
        sub.billingCycle = scheduled.newBillingCycle as typeof sub.billingCycle;
      }
      planApplied = true;
    } else {
      const lookup = await getPlanByRazorpayPlanIdFromDB(incomingPlanId);
      if (lookup) {
        sub.planSlug = lookup.plan.slug;
        sub.billingCycle = lookup.cycle;
        planApplied = true;
      }
    }
  }

  if (incomingPlanId) {
    sub.metadata = {
      ...sub.metadata,
      razorpayPlanId: incomingPlanId,
      lastUpdatedFromWebhook: new Date().toISOString(),
      ...(planApplied
        ? {
            scheduledChange: null,
            previousPlanSlug: sub.metadata?.previousPlanSlug ?? sub.planSlug,
          }
        : {}),
    };
  }
  await sub.save();

  if (planApplied && sub.status === "active") {
    await syncUserSubscriptionState({
      userId: sub.userId,
      subscriptionDocId: sub._id,
      status: "active",
      expiresAt: sub.current_period_end || sub.endDate,
      autopayActive: true,
    });
  }

  await emitBillingEvent({
    type: "subscription.updated",
    userId: sub.userId,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub.subscription_id ?? sub._id.toString(),
    payload: {
      planSlug: sub.planSlug,
      razorpayPlanId: incomingPlanId,
      quantity: subEntity?.quantity ?? null,
      remainingCount: subEntity?.remaining_count ?? null,
      planApplied,
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

/**
 * `subscription.upcoming` fires ~24h before Razorpay attempts the next charge.
 * Audit-only here — surface it on BillingEvent so future notification hooks
 * (email, push) can pick it up without touching the webhook entry point.
 */
const handleSubscriptionUpcoming: Handler = async (ctx) => {
  const subEntity = ctx.event.payload?.subscription?.entity;
  const sub = await loadSubscription(subEntity);
  const snap = readSubscriptionSnapshot(subEntity);

  await emitBillingEvent({
    type: "subscription.upcoming",
    userId: sub?.userId ?? null,
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "subscription",
    subjectId: sub?.subscription_id ?? subEntity?.id ?? null,
    payload: {
      nextChargeAt: snap.current_period_end?.toISOString() ?? null,
      planSlug: sub?.planSlug ?? null,
      amountPaise:
        typeof sub?.metadata?.basePlanAmount === "number"
          ? sub.metadata.basePlanAmount
          : null,
    },
  });
  return { status: "processed" };
};

/**
 * `invoice.paid` is sent by Razorpay when a subscription invoice settles. For
 * subscription-only billing, `subscription.charged` is the authoritative event
 * that creates the local SubscriptionInvoice + Payment rows. We accept this
 * event as already-handled to keep Razorpay's retry loop happy, and audit it
 * for cross-checking.
 */
const handleInvoicePaid: Handler = async (ctx) => {
  const invoiceEntity = ctx.event.payload?.invoice?.entity;
  await emitBillingEvent({
    type: "invoice.paid",
    actorType: "webhook",
    actorId: ctx.eventId,
    subjectType: "invoice",
    subjectId: invoiceEntity?.id ?? null,
    payload: {
      subscriptionId: invoiceEntity?.subscription_id ?? null,
      paymentId: invoiceEntity?.payment_id ?? null,
      amount: invoiceEntity?.amount ?? null,
    },
  });
  return { status: "processed" };
};

// ─── Registry ─────────────────────────────────────────────────────────────

const REGISTRY: Record<string, Handler> = {
  "payment.failed": handlePaymentFailed,
  "refund.created": handleRefundCreated,
  "refund.processed": handleRefundProcessed,
  "refund.failed": handleRefundFailed,

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
  "subscription.upcoming": handleSubscriptionUpcoming,

  "invoice.paid": handleInvoicePaid,

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
