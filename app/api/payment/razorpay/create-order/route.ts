import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Coupon from "@/models/Coupon";
import PendingTransaction from "@/models/PendingTransaction";
import { User } from "@/models/User";
import Subscription from "@/models/Subscription";
import crypto from "crypto";
import {
  getPlanBySlugFromDB,
  getPricingConfig,
} from "@/lib/config/getPricingConfig";
import {
  getEffectivePriceForCycle,
  resolveActiveCampaign,
} from "@/lib/pricing/pricingService";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      amount,
      currency = "INR",
      receipt,
      notes,
      couponCode,
      planSlug,
      planName,
      storageLimitBytes,
      planPriceINR,
      basePlanPriceINR,
      campaignType,
      campaignCyclesLeft,
      billingCycle,
    } = await req.json();

    await dbConnect();

    // 1. Authoritative Pricing Calculation
    const plan = await getPlanBySlugFromDB(planSlug);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const { campaign } = await getPricingConfig();
    
    // Find active subscription to determine user's current plan for campaign targeting
    const activeSubscription = await Subscription.findOne({
      userId: session.user.id,
      status: "active"
    }).lean();
    
    const userPlanSlug = activeSubscription?.planSlug || "free";
    const activeCampaign = resolveActiveCampaign(campaign, userPlanSlug);

    const priceAfterCampaign = getEffectivePriceForCycle(
      plan.pricing,
      billingCycle,
      activeCampaign?.discountPercent,
    );

    let finalAmount = priceAfterCampaign;
    let couponDiscount = 0;
    let validatedCouponId = null;

    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase().trim(),
        isActive: true,
      });

      if (coupon) {
        // Validation logic
        const now = new Date();
        const isValid =
          now >= new Date(coupon.validFrom) &&
          now <= new Date(coupon.validTo) &&
          (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses);

        if (isValid) {
          validatedCouponId = coupon._id;
          if (coupon.discountType === "percent") {
            couponDiscount = Math.round(
              priceAfterCampaign * (coupon.discountValue / 100),
            );
          } else {
            couponDiscount = Math.min(
              coupon.discountValue,
              priceAfterCampaign - 1,
            );
          }
          finalAmount = priceAfterCampaign - couponDiscount;
        }
      }
    }

    // Razorpay minimum requirement: 1 INR
    finalAmount = Math.max(1, finalAmount);

    const options = {
      amount: Math.round(finalAmount * 100), // Razorpay expects amount in paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes: {
        ...notes,
        userId: session.user.id,
        planSlug,
        couponCode: couponCode || "",
      },
    };

    const order = await razorpay.orders.create(options);

    // Store in PendingTransaction for verification
    const txnid = "TXN" + Date.now() + crypto.randomBytes(4).toString("hex");
    await PendingTransaction.create({
      txnid: order.id, // Use order.id as txnid for easier lookup
      userId: session.user.id,
      planName: plan.name,
      planSlug: plan.slug,
      storageLimitBytes: plan.storageLimitBytes,
      planPriceINR: priceAfterCampaign,
      basePlanPriceINR:
        plan.pricing.find((p) => p.cycle === billingCycle)?.priceINR ||
        priceAfterCampaign,
      campaignType: activeCampaign ? activeCampaign.discountDuration : null,
      campaignCyclesLeft:
        activeCampaign?.discountDuration === "limited"
          ? activeCampaign.discountCycles
          : null,
      billingCycle,
      paymentMethod: "direct",
      gateway: "razorpay",
      couponId: validatedCouponId ? validatedCouponId.toString() : undefined,
      couponCode,
      couponDiscount,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      expectedAmount: finalAmount,
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error: any) {
    console.error("Razorpay Order Creation Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create order" },
      { status: 500 },
    );
  }
}
