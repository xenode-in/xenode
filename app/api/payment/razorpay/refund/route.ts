import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
import { paymentLogger } from "@/lib/payment/razorpayUtils";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { paymentId, amount, reason = "customer_request" } = await req.json();

    if (!paymentId) {
      return NextResponse.json(
        { error: "Payment ID is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    // 1. Find payment
    const payment = await Payment.findOne({
      _id: paymentId,
      userId: session.user.id,
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status !== "success") {
      return NextResponse.json(
        { error: `Cannot refund payment with status: ${payment.status}` },
        { status: 400 },
      );
    }

    if (payment.refund_id) {
      return NextResponse.json(
        { error: "Refund already initiated" },
        { status: 400 },
      );
    }

    const razorpayPaymentId = payment.payment_id;

    if (!razorpayPaymentId) {
      return NextResponse.json(
        { error: "Missing Razorpay payment ID" },
        { status: 400 },
      );
    }

    // 2. Verify payment from Razorpay
    const razorpayPayment = await razorpay.payments.fetch(razorpayPaymentId);

    if (razorpayPayment.status !== "captured") {
      return NextResponse.json(
        { error: "Payment is not captured. Cannot refund." },
        { status: 400 },
      );
    }

    // ─── 15-DAY REFUND POLICY CHECK ──────────────────────────────────────────
    // Standard SaaS policy: students can claim a full refund within 15 days.
    const now = new Date();
    const paymentDate = new Date(payment.createdAt);
    const diffTime = Math.abs(now.getTime() - paymentDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 15) {
      paymentLogger.info(`Refund denied: ${diffDays} days since purchase for user ${session.user.id}`);
      return NextResponse.json(
        { error: `Refund period (15 days) has expired. You are at ${diffDays} days.` },
        { status: 400 },
      );
    }

    // 3. Calculate refund amount (in paise)
    const refundAmount = amount
      ? Math.round(amount * 100)
      : Math.round(payment.amount * 100);

    // 4. Create refund
    // We use speed: "optimum" to provide the best customer experience (instant where possible).
    // Receipt is mandatory for idempotency (prevents double refunds).
    try {
      const refund = await razorpay.payments.refund(razorpayPaymentId, {
        amount: refundAmount,
        speed: "optimum",
        receipt: `rfnd_${payment._id}_${Date.now()}`,
        notes: {
          reason: reason || "15-day money-back guarantee",
          userId: session.user.id,
          orderId: payment.order_id || "direct_payment"
        },
      });

      // 5. Update DB (mark as initiated)
      payment.status = "refund_initiated";
      payment.refund_id = refund.id;
      payment.refund_status = refund.status;
      payment.gatewayResponse = {
        ...payment.gatewayResponse,
        refundDetails: refund,
      };
      await payment.save();

      // 6. Immediate Downgrade for UX
      // (The webhook handles this too as a fail-safe)
      await Usage.findOneAndUpdate(
        { userId: session.user.id },
        {
          $set: {
            plan: "free",
            storageLimitBytes: FREE_TIER_LIMIT_BYTES,
            planExpiresAt: new Date(),
            isGracePeriod: false,
          },
        },
      );

      paymentLogger.info(`Refund ${refund.id} initiated for payment ${paymentId}`);

      return NextResponse.json({
        success: true,
        message: "Refund initiated successfully",
        refundId: refund.id,
        status: refund.status,
      });
    } catch (apiError: any) {
      // Re-throw to be caught by outer catch
      throw apiError;
    }
  } catch (error: any) {
    paymentLogger.error("Razorpay Refund Error:", error);

    return NextResponse.json(
      {
        error: error?.error?.description || error?.message || "Refund failed",
      },
      { status: 500 },
    );
  }
}

