import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Coupon from "@/models/Coupon";
import PendingTransaction from "@/models/PendingTransaction";
import crypto from "crypto";

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

    let finalAmount = amount;
    let couponDiscount = 0;
    let validatedCouponId = null;

    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase().trim(),
        isActive: true,
      });

      if (coupon) {
        // Validation logic (simplified, should match existing coupon logic)
        const now = new Date();
        const isValid =
          now >= new Date(coupon.validFrom) &&
          now <= new Date(coupon.validTo) &&
          (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses);

        if (isValid) {
          validatedCouponId = coupon._id;
          if (coupon.discountType === "percent") {
            couponDiscount = Math.round(amount * (coupon.discountValue / 100));
          } else {
            couponDiscount = Math.min(coupon.discountValue, amount - 1);
          }
          finalAmount = amount - couponDiscount;
        }
      }
    }

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
      planName,
      planSlug,
      storageLimitBytes,
      planPriceINR,
      basePlanPriceINR,
      campaignType,
      campaignCyclesLeft,
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
