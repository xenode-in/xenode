import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";
import Usage from "@/models/Usage";
import Subscription from "@/models/Subscription";
import Coupon from "@/models/Coupon";
import mongoose from "mongoose";
import { getSubscriptionEndDate } from "@/lib/pricing/pricingService";

export async function POST(req: Request) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(sign.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    await dbConnect();

    const pending = await PendingTransaction.findOne({ txnid: razorpay_order_id });
    if (!pending) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const now = new Date();
        const billingCycle = pending.billingCycle || "monthly";
        
        let subscriptionStartDate = now;
        const currentUsage = await Usage.findOne({ userId: pending.userId }).session(session);
        
        let baseDateForEnd = now;
        if (currentUsage && currentUsage.planExpiresAt && currentUsage.planExpiresAt > now) {
          baseDateForEnd = currentUsage.planExpiresAt;
        }
        
        const subscriptionEndDate = getSubscriptionEndDate(baseDateForEnd, billingCycle);

        // 1. Update Usage
        await Usage.findOneAndUpdate(
          { userId: pending.userId },
          {
            $set: {
              plan: pending.planSlug,
              storageLimitBytes: pending.storageLimitBytes,
              planPriceINR: pending.planPriceINR,
              basePlanPriceINR: pending.basePlanPriceINR,
              campaignType: pending.campaignType,
              campaignCyclesLeft: pending.campaignCyclesLeft ? Math.max(0, pending.campaignCyclesLeft - 1) : null,
              planActivatedAt: subscriptionStartDate,
              planExpiresAt: subscriptionEndDate,
              isGracePeriod: false,
              gracePeriodEndsAt: null,
            },
          },
          { upsert: true, session }
        );

        // 2. Update Subscription
        await Subscription.findOneAndUpdate(
          { userId: pending.userId },
          {
            $set: {
              planSlug: pending.planSlug,
              status: "active",
              billingCycle: pending.billingCycle,
              startDate: subscriptionStartDate,
              endDate: subscriptionEndDate,
              autoRenew: false, // For one-time payments
              metadata: {
                payment_id: razorpay_payment_id,
                order_id: razorpay_order_id,
              }
            }
          },
          { upsert: true, session }
        );

        // 3. Create Payment record
        await Payment.create([{
          userId: pending.userId,
          amount: pending.expectedAmount,
          currency: "INR",
          status: "success",
          txnid: razorpay_order_id,
          order_id: razorpay_order_id,
          payment_id: razorpay_payment_id,
          planName: pending.planName,
          billingCycle: pending.billingCycle,
          subscriptionStartDate,
          subscriptionEndDate,
          gatewayResponse: {
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_signature,
          },
        }], { session });

        // 4. Consume Coupon
        if (pending.couponId) {
          await Coupon.findByIdAndUpdate(pending.couponId, {
            $inc: { usedCount: 1 },
            $push: {
              usedBy: {
                userId: pending.userId,
                usedAt: new Date(),
                txnid: razorpay_order_id,
              },
            },
          }, { session });
        }

        // 5. Delete PendingTransaction
        await PendingTransaction.deleteOne({ txnid: razorpay_order_id }).session(session);
      });
    } finally {
      session.endSession();
    }

    return NextResponse.json({ success: true, paymentId: razorpay_payment_id });
  } catch (error: any) {
    console.error("Razorpay Verification Error:", error);
    return NextResponse.json({ error: error.message || "Verification failed" }, { status: 500 });
  }
}
