import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription, { type ISubscription } from "@/models/Subscription";
import { syncUserSubscriptionState } from "@/lib/subscriptions/service";
import { emitBillingEvent } from "@/lib/billing/events";

/**
 * Daily reconciliation. For every non-terminal Subscription doc we fetch the
 * authoritative state from Razorpay and:
 *   - If statuses agree → no-op.
 *   - If Razorpay shows a clear terminal/transitional state (cancelled, halted,
 *     completed, paused, active) and ours disagrees → auto-correct + emit
 *     `reconcile.drift_corrected`.
 *   - For anything more ambiguous → emit `reconcile.drift_detected` and leave
 *     state alone for a human to inspect via the admin audit log.
 *
 * Bounded by RECONCILE_BATCH_MAX so a single run can never hammer Razorpay.
 * The cron is scheduled once per day; one missed sub gets caught the next day.
 *
 * Auth: same Bearer secret pattern as /api/cron/expire-plans.
 */

const RECONCILE_BATCH_MAX = 500;

const TERMINAL: ISubscription["status"][] = ["cancelled", "completed", "expired"];

const STATUS_MAP: Record<string, ISubscription["status"] | undefined> = {
  created: "created",
  authenticated: "authenticated",
  active: "active",
  pending: "past_due",
  halted: "halted",
  paused: "paused",
  cancelled: "cancelled",
  completed: "completed",
  expired: "expired",
};

type UserStatus = Parameters<typeof syncUserSubscriptionState>[0]["status"];

const USER_STATUS: Record<ISubscription["status"], UserStatus> = {
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const subs = await Subscription.find({
    status: { $nin: TERMINAL },
    subscription_id: { $exists: true, $ne: null },
  })
    .sort({ updatedAt: 1 })
    .limit(RECONCILE_BATCH_MAX);

  let checked = 0;
  let corrected = 0;
  let drifted = 0;
  let errors = 0;

  for (const sub of subs) {
    if (!sub.subscription_id) continue;
    checked++;
    try {
      const remote = await razorpay.subscriptions.fetch(sub.subscription_id);
      const remoteStatus = STATUS_MAP[remote.status as string];
      if (!remoteStatus) {
        // Unknown Razorpay status — log drift and skip.
        drifted++;
        await emitBillingEvent({
          type: "reconcile.drift_detected",
          userId: sub.userId,
          actorType: "system",
          actorId: "cron",
          subjectType: "subscription",
          subjectId: sub.subscription_id,
          payload: {
            localStatus: sub.status,
            remoteStatus: remote.status,
            reason: "unknown_remote_status",
          },
        });
        continue;
      }
      if (remoteStatus === sub.status) continue;

      // Auto-correct.
      const before = sub.status;
      sub.status = remoteStatus;
      if (typeof remote.current_start === "number") {
        sub.current_period_start = new Date(remote.current_start * 1000);
      }
      if (typeof remote.current_end === "number") {
        sub.current_period_end = new Date(remote.current_end * 1000);
        sub.endDate = sub.current_period_end;
      }
      if (typeof remote.paid_count === "number") {
        sub.paid_count = remote.paid_count;
        sub.chargeCount = Math.max(sub.chargeCount ?? 0, remote.paid_count);
      }
      sub.metadata = {
        ...sub.metadata,
        lastReconciledAt: new Date().toISOString(),
      };
      await sub.save();

      await syncUserSubscriptionState({
        userId: sub.userId,
        subscriptionDocId: sub._id,
        status: USER_STATUS[remoteStatus],
        expiresAt: sub.current_period_end || sub.endDate || null,
        autopayActive: remoteStatus === "active",
      });

      corrected++;
      await emitBillingEvent({
        type: "reconcile.drift_corrected",
        userId: sub.userId,
        actorType: "system",
        actorId: "cron",
        subjectType: "subscription",
        subjectId: sub.subscription_id,
        payload: { from: before, to: remoteStatus },
      });
    } catch (error) {
      errors++;
      console.error(
        `[reconcile] failed for subscription ${sub.subscription_id}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return NextResponse.json({
    success: true,
    checked,
    corrected,
    drifted,
    errors,
    processedAt: new Date().toISOString(),
  });
}
