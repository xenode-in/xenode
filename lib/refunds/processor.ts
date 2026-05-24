import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import RefundRequest from "@/models/RefundRequest";
import Payment from "@/models/Payment";
import { BillingError } from "@/lib/billing/http";
import { emitBillingEvent } from "@/lib/billing/events";
import { cancelSubscription } from "@/lib/billing/subscriptions";
import { isRazorpaySDKError } from "@/lib/payment/razorpayUtils";

/**
 * Razorpay returns this when the merchant's settlement balance can't cover the
 * refund. The exact code is `BAD_REQUEST_ERROR`; we match on the description
 * keyword because Razorpay reuses BAD_REQUEST_ERROR for many causes.
 *
 *   "Your account does not have enough balance to carry out the refund
 *    operation. You can add funds to your account from your Razorpay
 *    dashboard or capture new payments."
 *
 * Treated as RETRYABLE — admin tops up via the Razorpay dashboard and
 * re-clicks "Approve". The RefundRequest stays in `pending`, Payment is rolled
 * back to `success`, no money moves.
 */
function isInsufficientBalanceError(error: unknown): boolean {
  if (!isRazorpaySDKError(error)) return false;
  const description = error.error?.description?.toLowerCase() ?? "";
  return (
    description.includes("not have enough balance") ||
    description.includes("insufficient balance")
  );
}

/**
 * Refund processor — server-side initiation of an admin-approved refund.
 *
 * Flow:
 *   1. Look up the RefundRequest by id (must be pending or approved).
 *   2. Mark RefundRequest.status = "approved" + decision metadata.
 *   3. Update Payment.status = "refund_initiated" (idempotency token).
 *   4. Call Razorpay refund API → returns refund id.
 *   5. Persist razorpayRefundId, status = "processing".
 *   6. Best-effort cancel the underlying Razorpay subscription (so renewals stop).
 *   7. The refund.processed webhook handler completes the loop later by setting
 *      status="completed" and downgrading the user. (No double-downgrade — the
 *      webhook handler is the single place that mutates Usage state.)
 *
 * Idempotency: re-running on a request that's already "processing"/"completed"
 * is a no-op. The Razorpay refund API itself is also idempotent on the same
 * payment_id when called with `speed: "normal"` (Razorpay returns the existing
 * refund object).
 */

interface InitiateRefundArgs {
  refundRequestId: string;
  adminId: string;
  adminUsername: string;
  decisionNote?: string;
}

interface InitiateRefundResult {
  status: "processing" | "completed";
  razorpayRefundId: string | null;
  alreadyProcessed: boolean;
}

export async function initiateRefund(
  args: InitiateRefundArgs,
): Promise<InitiateRefundResult> {
  await dbConnect();

  const refundRequest = await RefundRequest.findById(args.refundRequestId);
  if (!refundRequest) {
    throw new BillingError(404, "Refund request not found", "refund_not_found");
  }

  if (
    refundRequest.status === "processing" ||
    refundRequest.status === "completed"
  ) {
    return {
      status: refundRequest.status,
      razorpayRefundId: refundRequest.razorpayRefundId ?? null,
      alreadyProcessed: true,
    };
  }

  if (refundRequest.status === "denied" || refundRequest.status === "failed") {
    throw new BillingError(
      409,
      `Cannot process a ${refundRequest.status} refund request`,
      "refund_invalid_state",
    );
  }

  if (!refundRequest.razorpayPaymentId) {
    throw new BillingError(
      400,
      "Refund request has no associated Razorpay payment id",
      "refund_missing_payment",
    );
  }

  const payment = await Payment.findById(refundRequest.paymentId);
  if (!payment) {
    throw new BillingError(
      404,
      "Underlying payment record missing",
      "payment_not_found",
    );
  }

  if (payment.status === "refunded") {
    refundRequest.status = "completed";
    refundRequest.razorpayRefundId =
      payment.refund_id ?? refundRequest.razorpayRefundId;
    refundRequest.refundedAt = refundRequest.refundedAt ?? new Date();
    refundRequest.decidedBy = args.adminUsername;
    refundRequest.decidedAt = refundRequest.decidedAt ?? new Date();
    refundRequest.decisionNote = args.decisionNote ?? refundRequest.decisionNote;
    await refundRequest.save();
    return {
      status: "completed",
      razorpayRefundId: refundRequest.razorpayRefundId ?? null,
      alreadyProcessed: true,
    };
  }

  // Mark approved + initiated in one save so a retry sees consistent state.
  refundRequest.status = "approved";
  refundRequest.decidedBy = args.adminUsername;
  refundRequest.decidedAt = new Date();
  refundRequest.decisionNote = args.decisionNote ?? refundRequest.decisionNote;
  await refundRequest.save();

  payment.status = "refund_initiated";
  await payment.save();

  // Razorpay refund API. Amount is in paise. Full refund => omit amount and
  // Razorpay refunds the full captured amount of the payment.
  let refundResp: { id?: string; status?: string; amount?: number } | null = null;
  try {
    refundResp = (await razorpay.payments.refund(
      refundRequest.razorpayPaymentId,
      {
        speed: "normal",
        notes: {
          refund_request_id: String(refundRequest._id),
          ticket_id: String(refundRequest.ticketId),
          decided_by: args.adminUsername,
        },
      } as never,
    )) as { id?: string; status?: string; amount?: number };
  } catch (error: unknown) {
    // Always roll back the Payment status — no money moved.
    payment.status = "success";
    await payment.save();

    // Insufficient merchant balance is a transient, retryable condition. Keep
    // the RefundRequest in `pending` so the admin can simply top up and
    // re-click Approve, no need to recreate the request or unwind a "failed"
    // state. We still record what happened on the request for visibility.
    if (isInsufficientBalanceError(error)) {
      refundRequest.status = "pending";
      refundRequest.decidedBy = null;
      refundRequest.decidedAt = null;
      // Preserve the admin's note from this attempt but tag it as a retry hint.
      refundRequest.failureReason =
        "Razorpay account balance was insufficient at last attempt. Add funds in the Razorpay dashboard and try again.";
      refundRequest.metadata = {
        ...refundRequest.metadata,
        lastInsufficientBalanceAt: new Date().toISOString(),
        lastInsufficientBalanceBy: args.adminUsername,
      };
      await refundRequest.save();

      await emitBillingEvent({
        type: "refund.retry_needed",
        userId: refundRequest.userId,
        actorType: "admin",
        actorId: args.adminId,
        subjectType: "refund",
        subjectId: String(refundRequest._id),
        payload: {
          reason: "insufficient_balance",
          paymentId: refundRequest.razorpayPaymentId,
        },
      });

      throw new BillingError(
        402,
        "Razorpay account doesn't have enough balance to process this refund. Add funds via the Razorpay dashboard, then click Approve again.",
        "razorpay_insufficient_balance",
      );
    }

    // Any other Razorpay/SDK error — treat as a hard failure so the admin can
    // investigate. The request can still be retried by re-running approve
    // (initiateRefund is idempotent on already-completed/processing requests).
    refundRequest.status = "failed";
    refundRequest.failureReason =
      error instanceof Error ? error.message : "Razorpay refund call failed";
    await refundRequest.save();

    await emitBillingEvent({
      type: "refund.failed",
      userId: refundRequest.userId,
      actorType: "admin",
      actorId: args.adminId,
      subjectType: "refund",
      subjectId: String(refundRequest._id),
      payload: {
        reason: refundRequest.failureReason,
        paymentId: refundRequest.razorpayPaymentId,
      },
    });
    throw error;
  }

  const refundId = refundResp?.id ?? null;

  refundRequest.razorpayRefundId = refundId;
  refundRequest.status = "processing";
  payment.refund_id = refundId ?? undefined;
  payment.refund_status = "processing";

  await Promise.all([refundRequest.save(), payment.save()]);

  // Best-effort: cancel the underlying Razorpay subscription so it stops
  // future charges immediately. Failure here doesn't roll back the refund —
  // the user has the money back; the worst case is one more charge attempt
  // that Razorpay will fail because the customer disputed.
  if (refundRequest.razorpaySubscriptionId) {
    try {
      await cancelSubscription({
        userId: refundRequest.userId,
        subscriptionId: refundRequest.razorpaySubscriptionId,
        cancelAtPeriodEnd: false,
        actorType: "admin",
        actorId: args.adminId,
      });
    } catch (cancelError) {
      console.error("[refunds.processor] subscription cancel failed", {
        refundRequestId: String(refundRequest._id),
        error: cancelError instanceof Error ? cancelError.message : cancelError,
      });
    }
  }

  await emitBillingEvent({
    type: "refund.initiated",
    userId: refundRequest.userId,
    actorType: "admin",
    actorId: args.adminId,
    subjectType: "refund",
    subjectId: String(refundRequest._id),
    payload: {
      razorpayRefundId: refundId,
      paymentId: refundRequest.razorpayPaymentId,
      amount: refundRequest.amount,
      currency: refundRequest.currency,
    },
  });

  return {
    status: "processing",
    razorpayRefundId: refundId,
    alreadyProcessed: false,
  };
}

interface DenyRefundArgs {
  refundRequestId: string;
  adminId: string;
  adminUsername: string;
  reason: string;
}

export async function denyRefund(args: DenyRefundArgs) {
  await dbConnect();
  const refundRequest = await RefundRequest.findById(args.refundRequestId);
  if (!refundRequest) {
    throw new BillingError(404, "Refund request not found", "refund_not_found");
  }
  if (refundRequest.status !== "pending") {
    throw new BillingError(
      409,
      `Cannot deny a refund request in "${refundRequest.status}" state`,
      "refund_invalid_state",
    );
  }

  refundRequest.status = "denied";
  refundRequest.decidedBy = args.adminUsername;
  refundRequest.decidedAt = new Date();
  refundRequest.decisionNote = args.reason;
  await refundRequest.save();

  await emitBillingEvent({
    type: "refund.denied",
    userId: refundRequest.userId,
    actorType: "admin",
    actorId: args.adminId,
    subjectType: "refund",
    subjectId: String(refundRequest._id),
    payload: { reason: args.reason },
  });

  return { status: "denied" as const };
}

/**
 * Lookup helper for the webhook handler. Finds the RefundRequest by either
 * razorpayRefundId or razorpayPaymentId. Returns null when none matches —
 * webhook flow then proceeds with payment-only updates.
 */
export async function findRefundRequestForWebhook(opts: {
  razorpayRefundId?: string | null;
  razorpayPaymentId?: string | null;
}) {
  if (!opts.razorpayRefundId && !opts.razorpayPaymentId) return null;
  await dbConnect();
  if (opts.razorpayRefundId) {
    const r = await RefundRequest.findOne({
      razorpayRefundId: opts.razorpayRefundId,
    });
    if (r) return r;
  }
  if (opts.razorpayPaymentId) {
    return RefundRequest.findOne({
      razorpayPaymentId: opts.razorpayPaymentId,
      status: { $in: ["approved", "processing"] },
    }).sort({ createdAt: -1 });
  }
  return null;
}

/** Re-export mongoose helper for testing parity, not used at runtime here. */
export function _testIsValidObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id);
}
