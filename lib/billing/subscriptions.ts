import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription, { type ISubscription } from "@/models/Subscription";
import { syncUserSubscriptionState } from "@/lib/subscriptions/service";
import { BillingError } from "./http";
import { BillingEventType, emitBillingEvent } from "./events";

/**
 * High-level subscription lifecycle operations. Wraps the existing helpers
 * in `lib/subscriptions/service.ts` and adds:
 *   - Consistent error semantics (BillingError)
 *   - BillingEvent emission on every transition
 *   - Idempotent cancel (calling twice is safe)
 *
 * Webhook-driven status changes still happen in `lib/billing/webhooks/handlers.ts`;
 * this file is the API-route-side counterpart.
 */

const TERMINAL_STATUSES = new Set<ISubscription["status"]>([
  "cancelled",
  "completed",
  "expired",
]);

type UserStatus = Parameters<typeof syncUserSubscriptionState>[0]["status"];

const SUBSCRIPTION_TO_USER_STATUS: Record<ISubscription["status"], UserStatus> = {
  created: "none",
  authenticated: "active",
  active: "active",
  pending: "past_due",
  past_due: "past_due",
  halted: "halted",
  paused: "active",
  cancelled: "cancelled",
  completed: "cancelled",
  expired: "cancelled",
};

export async function findActiveSubscription(
  userId: string,
  subscriptionId?: string,
): Promise<ISubscription | null> {
  await dbConnect();
  if (subscriptionId) {
    return Subscription.findOne({
      userId,
      subscription_id: subscriptionId,
    });
  }
  return Subscription.findOne({ userId }).sort({ createdAt: -1 });
}

export interface PauseResumeArgs {
  userId: string;
  subscriptionId?: string;
  actorType: "user" | "admin";
  actorId: string;
}

export async function pauseSubscription(args: PauseResumeArgs): Promise<{
  status: ISubscription["status"];
}> {
  await dbConnect();
  const sub = await findActiveSubscription(args.userId, args.subscriptionId);

  if (!sub?.subscription_id) {
    throw new BillingError(404, "Subscription not found", "subscription_missing");
  }
  if (sub.status === "paused") {
    return { status: sub.status };
  }
  if (sub.status !== "active") {
    throw new BillingError(
      409,
      `Only active subscriptions can be paused (current: ${sub.status})`,
      "subscription_not_active",
    );
  }

  await razorpay.subscriptions.pause(sub.subscription_id, {
    pause_at: "now",
  } as never);

  sub.status = "paused";
  sub.metadata = {
    ...sub.metadata,
    pausedAt: new Date().toISOString(),
    pausedBy: args.actorType,
  };
  await sub.save();

  await syncUserSubscriptionState({
    userId: args.userId,
    subscriptionDocId: sub._id,
    status: "active",
    expiresAt: sub.current_period_end || sub.endDate,
    autopayActive: false,
  });

  await emitBillingEvent({
    type: BillingEventType.SUBSCRIPTION_PAUSED,
    userId: args.userId,
    actorType: args.actorType,
    actorId: args.actorId,
    subjectType: "subscription",
    subjectId: sub.subscription_id,
    payload: { planSlug: sub.planSlug, billingCycle: sub.billingCycle },
  });

  return { status: sub.status };
}

export async function resumeSubscription(args: PauseResumeArgs): Promise<{
  status: ISubscription["status"];
}> {
  await dbConnect();
  const sub = await findActiveSubscription(args.userId, args.subscriptionId);

  if (!sub?.subscription_id) {
    throw new BillingError(404, "Subscription not found", "subscription_missing");
  }
  if (sub.status === "active") {
    return { status: sub.status };
  }
  if (sub.status !== "paused") {
    throw new BillingError(
      409,
      `Only paused subscriptions can be resumed (current: ${sub.status})`,
      "subscription_not_paused",
    );
  }

  await razorpay.subscriptions.resume(sub.subscription_id, {
    resume_at: "now",
  } as never);

  sub.status = "active";
  sub.metadata = {
    ...sub.metadata,
    resumedAt: new Date().toISOString(),
    resumedBy: args.actorType,
  };
  await sub.save();

  await syncUserSubscriptionState({
    userId: args.userId,
    subscriptionDocId: sub._id,
    status: "active",
    expiresAt: sub.current_period_end || sub.endDate,
    autopayActive: true,
  });

  await emitBillingEvent({
    type: BillingEventType.SUBSCRIPTION_RESUMED,
    userId: args.userId,
    actorType: args.actorType,
    actorId: args.actorId,
    subjectType: "subscription",
    subjectId: sub.subscription_id,
    payload: { planSlug: sub.planSlug, billingCycle: sub.billingCycle },
  });

  return { status: sub.status };
}

export interface CancelArgs {
  userId: string;
  subscriptionId?: string;
  cancelAtPeriodEnd: boolean;
  actorType: "user" | "admin";
  actorId: string;
}

export async function cancelSubscription(args: CancelArgs): Promise<{
  status: ISubscription["status"];
  cancelAtPeriodEnd: boolean;
  alreadyCancelled: boolean;
}> {
  await dbConnect();
  const sub = await findActiveSubscription(args.userId, args.subscriptionId);

  if (!sub?.subscription_id) {
    throw new BillingError(404, "Subscription not found", "subscription_missing");
  }

  if (TERMINAL_STATUSES.has(sub.status)) {
    return {
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      alreadyCancelled: true,
    };
  }

  await razorpay.subscriptions.cancel(sub.subscription_id, {
    cancel_at_cycle_end: args.cancelAtPeriodEnd,
  } as never);

  if (args.cancelAtPeriodEnd) {
    sub.cancelAtPeriodEnd = true;
  } else {
    sub.status = "cancelled";
  }
  sub.metadata = {
    ...sub.metadata,
    cancelledAt: new Date().toISOString(),
    cancelledBy: args.actorType,
  };
  await sub.save();

  if (!args.cancelAtPeriodEnd) {
    await syncUserSubscriptionState({
      userId: args.userId,
      subscriptionDocId: sub._id,
      status: "cancelled",
      expiresAt: sub.current_period_end || sub.endDate || null,
      autopayActive: false,
    });
  }

  await emitBillingEvent({
    type:
      args.actorType === "admin"
        ? BillingEventType.ADMIN_SUBSCRIPTION_CANCELLED
        : BillingEventType.SUBSCRIPTION_CANCELLED,
    userId: args.userId,
    actorType: args.actorType,
    actorId: args.actorId,
    subjectType: "subscription",
    subjectId: sub.subscription_id,
    payload: {
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      planSlug: sub.planSlug,
      billingCycle: sub.billingCycle,
    },
  });

  return {
    status: sub.status,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
    alreadyCancelled: false,
  };
}

/**
 * Map a Razorpay subscription status to our internal status + corresponding
 * user-level status. Used by the webhook dispatcher to centralise transitions.
 */
export function mapSubscriptionStatus(
  internalStatus: ISubscription["status"],
): UserStatus {
  return SUBSCRIPTION_TO_USER_STATUS[internalStatus] ?? "none";
}
