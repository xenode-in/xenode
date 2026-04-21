import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import Subscription from "@/models/Subscription";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";
import Coupon from "@/models/Coupon";
import WebhookLog from "@/models/WebhookLog";
import { getPlanBySlugFromDB } from "@/lib/config/getPricingConfig";
import { getSubscriptionEndDate } from "@/lib/pricing/pricingService";
import { paymentLogger } from "./razorpayUtils";

/**
 * fulfillOrder
 * 
 * Atomically marks a payment as successful, updates the user's plan limits,
 * and records the payment history.
 */
export async function fulfillOrder(
  orderId: string,
  paymentId: string,
  gatewayResponse?: any
) {
  await dbConnect();
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Idempotency Check: Has this payment already been processed?
    const existingPayment = await Payment.findOne({ payment_id: paymentId }).session(session);
    if (existingPayment && existingPayment.status === "success") {
      paymentLogger.info(`Payment ${paymentId} already fulfilled. Skipping.`);
      await session.abortTransaction();
      return { success: true, alreadyProcessed: true };
    }

    // 2. Resolve the original intent (PendingTransaction)
    // Razorpay Order ID is stored in the 'txnid' field.
    const pending = await PendingTransaction.findOne({ txnid: orderId }).session(session);

    if (!pending) {
      paymentLogger.error(`No PendingTransaction found for order ${orderId}`);
      // If we don't have a pending record, we can't safely fulfill.
      // In production, you might try to recover from notes.
      await session.abortTransaction();
      return { success: false, error: "Pending transaction not found" };
    }

    const { userId, planSlug, billingCycle, expectedAmount } = pending;

    // 3. Get Plan Details (Storage Limits)
    const planConfig = await getPlanBySlugFromDB(planSlug);
    if (!planConfig) {
      throw new Error(`Plan configuration not found for slug: ${planSlug}`);
    }

    const storageLimitBytes = planConfig.storageLimitBytes;
    const startDate = new Date();
    const endDate = getSubscriptionEndDate(startDate, billingCycle);

    // 4. Perform Atomic Updates
    
    // A. Create/Update Payment entry
    // We attempt to extract the payment method from the gateway response if possible.
    let paymentMethod = "unknown";
    if (gatewayResponse?.method) {
      paymentMethod = gatewayResponse.method;
    } else if (gatewayResponse?.payload?.payment?.entity?.method) {
      paymentMethod = gatewayResponse.payload.payment.entity.method;
    }

    await Payment.findOneAndUpdate(
      { order_id: orderId },
      {
        $set: {
          userId,
          payment_id: paymentId,
          txnid: orderId, // Razorpay order Id is our unique txn identifier
          amount: expectedAmount,
          currency: "INR",
          status: "success",
          method: paymentMethod,
          planName: pending.planName,
          billingCycle: pending.billingCycle,
          subscriptionStartDate: startDate,
          subscriptionEndDate: endDate,
          gatewayResponse: gatewayResponse || {},
        },
      },
      { upsert: true, session }
    );

    // B. Update Usage (Storage & Expiry)
    await Usage.findOneAndUpdate(
      { userId },
      {
        $set: {
          plan: planSlug,
          storageLimitBytes,
          planActivatedAt: startDate,
          planExpiresAt: endDate,
          planPriceINR: expectedAmount,
          isGracePeriod: false,
          gracePeriodEndsAt: null,
        },
      },
      { upsert: true, session }
    );

    // C. Update Subscription (Current Status)
    await Subscription.findOneAndUpdate(
      { userId },
      {
        $set: {
          planSlug,
          status: "active",
          billingCycle,
          startDate,
          endDate,
          autoRenew: false, // Manual direct payment doesn't auto-renew by default
        },
      },
      { upsert: true, session }
    );

    // D. Consume Coupon (if applicable)
    if (pending.couponCode) {
      await Coupon.findOneAndUpdate(
        { code: pending.couponCode },
        { $inc: { usedCount: 1 } },
        { session }
      );
    }

    // E. Cleanup PendingTransaction
    await PendingTransaction.deleteOne({ txnid: orderId }).session(session);


    await session.commitTransaction();
    paymentLogger.info(`Successfully fulfilled order ${orderId} for user ${userId}`);
    return { success: true };
  } catch (error: any) {
    await session.abortTransaction();
    paymentLogger.error(`Fulfillment failed for order ${orderId}`, error);
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * processRefund
 * 
 * Atomically marks a payment as refunded and downgrades the user to Free tier.
 */
export async function processRefund(
  paymentId: string,
  refundId: string,
  rawEvent?: any
) {
  await dbConnect();
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find existing payment
    const payment = await Payment.findOne({ payment_id: paymentId }).session(session);
    if (!payment) {
      paymentLogger.error(`Refund failed: Payment ${paymentId} not found`);
      await session.abortTransaction();
      return { success: false, error: "Payment not found" };
    }

    if (payment.status === "refunded") {
      paymentLogger.info(`Payment ${paymentId} already marked as refunded.`);
      await session.abortTransaction();
      return { success: true };
    }

    const { userId } = payment;

    // 2. Perform Atomic Downgrade
    
    // A. Update Payment status
    payment.status = "refunded";
    payment.refund_id = refundId;
    payment.gatewayResponse = {
      ...payment.gatewayResponse,
      refundEvent: rawEvent || {},
    };
    await payment.save({ session });

    // B. Reset Usage to Free Tier
    await Usage.findOneAndUpdate(
      { userId },
      {
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_LIMIT_BYTES,
          planExpiresAt: new Date(), // Expire current plan immediately
          isGracePeriod: false,
        },
      },
      { session }
    );

    // C. Mark Subscription as Cancelled
    await Subscription.findOneAndUpdate(
      { userId },
      { $set: { status: "cancelled" } },
      { session }
    );

    await session.commitTransaction();
    paymentLogger.info(`Successfully processed refund ${refundId} for user ${userId}`);
    return { success: true };
  } catch (error: any) {
    await session.abortTransaction();
    paymentLogger.error(`Refund processing failed for payment ${paymentId}`, error);
    throw error;
  } finally {
    session.endSession();
  }
}
