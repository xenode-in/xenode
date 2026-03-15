import mongoose, { ClientSession } from "mongoose";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import PendingTransaction, { IPendingTransaction } from "@/models/PendingTransaction";
import Coupon from "@/models/Coupon";
import SubscriptionService from "./SubscriptionService";
import { getSubscriptionEndDate } from "./pricingService";

export default class PaymentService {
  /**
   * Idempotently process a successful PayU transaction
   */
  static async processSuccessfulPayment(
    txnid: string,
    amount: string,
    productinfo: string,
    udf1: string,
    payuData: any,
    session: ClientSession
  ) {
    const existingPayment = await Payment.findOne({ txnid }).session(session);
    if (existingPayment) {
      return { success: true, isIdempotent: true, plan: existingPayment.planName, amount: existingPayment.amount?.toString() };
    }

    const pending = await PendingTransaction.findOne({ txnid, userId: udf1 }).session(session);
    if (!pending) {
      throw new Error("transaction_not_found");
    }

    // ── Secure Payment Verification ──
    if (pending.expectedAmount !== undefined && Math.abs(parseFloat(amount) - pending.expectedAmount) > 0.01) {
      throw new Error("amount_mismatch");
    }

    if (pending.planName !== productinfo) {
      throw new Error("product_mismatch");
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const user = await db.collection("user").findOne({ _id: new mongoose.Types.ObjectId(udf1) }, { session });
    if (!user) {
      throw new Error("user_not_found");
    }

    if (pending.billingAddress) {
      await db.collection("user").updateOne(
        { _id: new mongoose.Types.ObjectId(udf1) },
        { $set: { billingAddress: pending.billingAddress } },
        { session }
      );
    }

    const authpayuid = payuData.payuMoneyId || payuData.authpayuid || null;

    // ── Subscription window ──
    const billingCycle = pending.billingCycle ?? "monthly";
    const now = new Date();
    
    let subscriptionStartDate = now;
    const currentUsage = await Usage.findOne({ userId: user._id.toString() }).session(session);
    
    let baseDateForEnd = now;
    if (currentUsage && currentUsage.planExpiresAt && currentUsage.planExpiresAt > now) {
      baseDateForEnd = currentUsage.planExpiresAt;
    }
    
    const subscriptionEndDate = getSubscriptionEndDate(baseDateForEnd, billingCycle);

    // ── Update Usage ──
    const campaignCyclesLeft = pending.campaignCyclesLeft != null
      ? Math.max(0, pending.campaignCyclesLeft - 1) 
      : null;

    await Usage.findOneAndUpdate(
      { userId: user._id.toString() },
      {
        $set: {
          plan: pending.planSlug,
          storageLimitBytes: pending.storageLimitBytes,
          planPriceINR: pending.planPriceINR,
          basePlanPriceINR: pending.basePlanPriceINR,
          campaignType: pending.campaignType,
          campaignCyclesLeft: campaignCyclesLeft,
          planActivatedAt: subscriptionStartDate,
          planExpiresAt: subscriptionEndDate,
          ...(authpayuid ? { autopayMandateId: authpayuid, autopayActive: true } : {}),
        },
      },
      { upsert: true, session }
    );

    // ── Update Subscription ──
    await SubscriptionService.createOrUpdateSubscription(
      user._id.toString(),
      pending,
      subscriptionStartDate,
      subscriptionEndDate,
      authpayuid,
      txnid,
      session
    );

    // ── Create Payment ──
    await Payment.create([{
      userId: user._id.toString(),
      amount: parseFloat(amount),
      currency: "INR",
      status: "success",
      txnid,
      planName: pending.planName,
      billingCycle,
      subscriptionStartDate,
      subscriptionEndDate,
      payuResponse: {
        status: payuData.status,
        txnid: payuData.txnid,
        mihpayid: payuData.mihpayid,
        mode: payuData.mode,
        PG_TYPE: payuData.PG_TYPE,
        bank_ref_num: payuData.bank_ref_num,
        ...(authpayuid ? { authpayuid } : {}),
      },
    }], { session });

    // ── Consume Coupon ──
    if (pending.couponId) {
      await Coupon.findByIdAndUpdate(pending.couponId, {
        $inc: { usedCount: 1 },
        $push: {
          usedBy: {
            userId: udf1,
            usedAt: new Date(),
            txnid,
          },
        },
      }, { session });
    }

    await PendingTransaction.deleteOne({ txnid: txnid || "" }).session(session);

    return {
      success: true,
      isIdempotent: false,
      plan: pending.planName,
      amount: pending.planPriceINR.toString(),
      method: pending.paymentMethod,
      cycle: billingCycle,
      coupon: pending.couponCode
    };
  }
}
