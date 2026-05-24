import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import Subscription from "@/models/Subscription";
import RefundRequest from "@/models/RefundRequest";
import type { IPayment } from "@/models/Payment";

/**
 * Refund eligibility — 14-day money-back guarantee on the FIRST payment of a
 * subscription. Renewals are NOT refundable.
 *
 * Rules:
 *   1. User must have a payment with status="success".
 *   2. The payment must be the chronologically first successful payment for
 *      its subscription (chargeCount == 1, equivalently — the activation charge).
 *   3. Payment.createdAt + 14 days must be in the future.
 *   4. No existing pending/approved/processing/completed refund for this payment.
 *   5. Payment must not already be refunded.
 *
 * The function returns a structured result that the API + UI both consume.
 */

export const REFUND_WINDOW_DAYS = 14;
const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  payment?: {
    id: string;
    razorpayPaymentId: string;
    amount: number;
    currency: string;
    planName: string;
    billingCycle: string;
    paidAt: string;
    windowEndsAt: string;
    daysRemaining: number;
    subscriptionId: string | null;
    razorpaySubscriptionId: string | null;
  };
  existingRequest?: {
    id: string;
    status: string;
    createdAt: string;
  };
}

/**
 * Returns the user's first successful payment (the subscription activation
 * charge). For users without a subscription, returns the only successful
 * payment if any. Returns null when no eligible payment exists.
 */
async function findFirstSuccessfulPayment(userId: string): Promise<IPayment | null> {
  return Payment.findOne({
    userId,
    status: "success",
  })
    .sort({ createdAt: 1 })
    .lean<IPayment>();
}

export async function checkRefundEligibility(
  userId: string,
): Promise<EligibilityResult> {
  await dbConnect();

  const firstPayment = await findFirstSuccessfulPayment(userId);
  if (!firstPayment) {
    return {
      eligible: false,
      reason:
        "No paid subscription found. Refunds are only available on the first payment of a paid plan.",
    };
  }

  if (firstPayment.status !== "success") {
    return {
      eligible: false,
      reason: `This payment is not eligible (status: ${firstPayment.status}).`,
    };
  }

  const paidAt = new Date(firstPayment.createdAt).getTime();
  const windowEndsAt = paidAt + REFUND_WINDOW_MS;
  const now = Date.now();
  const daysRemaining = Math.max(0, Math.ceil((windowEndsAt - now) / (24 * 60 * 60 * 1000)));

  // Window check — strict less than. Window expires at exact 14 days.
  if (now >= windowEndsAt) {
    return {
      eligible: false,
      reason: `The 14-day refund window has closed. Refunds are only available within ${REFUND_WINDOW_DAYS} days of your first payment.`,
      payment: await buildPaymentSummary(firstPayment, windowEndsAt, daysRemaining),
    };
  }

  // Block when there's any non-terminal/terminal-successful refund already.
  const existing = await RefundRequest.findOne({
    paymentId: firstPayment._id,
    status: { $in: ["pending", "approved", "processing", "completed"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (existing) {
    const existingId = (existing as { _id: unknown })._id;
    const existingStatus = (existing as { status: string }).status;
    const existingCreatedAt = (existing as { createdAt: Date }).createdAt;

    return {
      eligible: false,
      reason:
        existingStatus === "completed"
          ? "This payment has already been refunded."
          : "A refund request for this payment is already in progress.",
      payment: await buildPaymentSummary(firstPayment, windowEndsAt, daysRemaining),
      existingRequest: {
        id: String(existingId),
        status: existingStatus,
        createdAt: new Date(existingCreatedAt).toISOString(),
      },
    };
  }

  return {
    eligible: true,
    payment: await buildPaymentSummary(firstPayment, windowEndsAt, daysRemaining),
  };
}

async function buildPaymentSummary(
  payment: IPayment,
  windowEndsAtMs: number,
  daysRemaining: number,
): Promise<NonNullable<EligibilityResult["payment"]>> {
  // Try to find the linked subscription (by Razorpay payment_id → subscription_id
  // via the invoice, or by user). For most cases the activation payment carries
  // gatewayResponse with subscription context.
  let razorpaySubscriptionId: string | null = null;
  let subscriptionDocId: string | null = null;

  const gatewayResponse = (payment.gatewayResponse ?? {}) as Record<string, unknown>;
  const paymentEntity =
    (gatewayResponse.paymentEntity as { subscription_id?: string } | undefined) ??
    undefined;
  if (typeof paymentEntity?.subscription_id === "string") {
    razorpaySubscriptionId = paymentEntity.subscription_id;
  }

  if (!razorpaySubscriptionId) {
    // Fallback: find by user. Picks the earliest matching subscription.
    const sub = await Subscription.findOne({ userId: payment.userId })
      .sort({ createdAt: 1 })
      .lean();
    if (sub) {
      razorpaySubscriptionId = (sub as { subscription_id?: string }).subscription_id ?? null;
      subscriptionDocId = String((sub as { _id: unknown })._id);
    }
  } else {
    const sub = await Subscription.findOne({
      subscription_id: razorpaySubscriptionId,
    }).lean();
    if (sub) subscriptionDocId = String((sub as { _id: unknown })._id);
  }

  return {
    id: String(payment._id),
    razorpayPaymentId: payment.payment_id ?? "",
    amount: payment.amount,
    currency: payment.currency,
    planName: payment.planName,
    billingCycle: payment.billingCycle,
    paidAt: new Date(payment.createdAt).toISOString(),
    windowEndsAt: new Date(windowEndsAtMs).toISOString(),
    daysRemaining,
    subscriptionId: subscriptionDocId,
    razorpaySubscriptionId,
  };
}
