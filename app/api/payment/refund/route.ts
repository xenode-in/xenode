import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";

/**
 * sha512 helper for PayU hashing.
 */
function sha512(str: string): string {
  return crypto.createHash("sha512").update(str).digest("hex");
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { paymentId } = await req.json();
    if (!paymentId) {
      return NextResponse.json({ error: "Payment ID is required" }, { status: 400 });
    }

    await dbConnect();

    // 1. Find and validate the payment
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
        { status: 400 }
      );
    }

    // 2. Enforce 30-day refund policy
    const now = new Date();
    const paymentDate = new Date(payment.createdAt);
    const diffTime = Math.abs(now.getTime() - paymentDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      return NextResponse.json(
        { error: "Refund period (30 days) has expired for this payment." },
        { status: 400 }
      );
    }

    const key = process.env.PAYU_MERCHANT_KEY || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";
    if (!key || !salt) {
      console.error("PayU credentials missing");
      return NextResponse.json({ error: "Refund service unavailable" }, { status: 500 });
    }

    // 3. Initiate PayU Refund
    // var1 is the Payu ID (mihpayid) of the transaction.
    // var2 should contain the Token ID (unique token from the merchant).
    // var3 parameter should contain the amount that needs to be refunded.
    const command = "cancel_refund_transaction";
    const mihpayid = payment.payuResponse?.mihpayid;

    if (!mihpayid) {
      return NextResponse.json(
        { error: "This transaction is missing the mandatory PayU ID (mihpayid) required for refunds. Only transactions processed with the updated gateway logic can be refunded via this API." },
        { status: 400 }
      );
    }

    const var1 = mihpayid;
    const refundId = "REF" + Date.now().toString().slice(-10) + crypto.randomBytes(4).toString("hex"); // Max 23 chars
    const amount = payment.amount.toFixed(2);

    const hash = sha512(`${key}|${command}|${var1}|${salt}`);

    const isTestMode = process.env.NODE_ENV !== "production";
    const payuUrl = isTestMode
      ? "https://test.payu.in/merchant/postservice.php?form=2"
      : "https://info.payu.in/merchant/postservice.php?form=2";

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appBaseUrl) {
      return NextResponse.json({ error: "Refund service unavailable" }, { status: 500 });
    }

    const formData = new URLSearchParams();
    formData.append("key", key);
    formData.append("command", command);
    formData.append("var1", var1); // mihpayid
    formData.append("var2", refundId); // unique token id
    formData.append("var3", amount); // amount to refund
    formData.append("var5", new URL("/api/payment/payu/refund-callback", appBaseUrl).toString());
    formData.append("hash", hash);

    const response = await fetch(payuUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const resultText = await response.text();
    // PayU postservice returns JSON string or sometimes a status message
    let result: { status?: number; msg?: string; [key: string]: unknown };
    try {
      result = JSON.parse(resultText);
    } catch {
      console.error("Failed to parse PayU refund response:", resultText);
      return NextResponse.json({ error: "Invalid response from payment gateway" }, { status: 502 });
    }

    /**
     * PayU Refund Response Example:
     * { "status": 1, "msg": "Refund Initiated", "request_id": "...", ... }
     * status: 1 means success, 0 means failure
     */
    if (result.status !== 1) {
      console.error("PayU Refund Failed:", result);
      return NextResponse.json(
        { error: result.msg || "Refund initiation failed at payment gateway" },
        { status: 400 }
      );
    }

    // 4. Update Payment status
    payment.status = "refunded";
    if (!payment.payuResponse) payment.payuResponse = {};
    payment.payuResponse.refundDetails = result;
    payment.payuResponse.refundId = refundId;
    await payment.save();

    // 5. Downgrade User immediately
    await Usage.findOneAndUpdate(
      { userId: session.user.id },
      {
        $set: {
          plan: "free",
          storageLimitBytes: FREE_TIER_LIMIT_BYTES,
          planPriceINR: 0,
          planExpiresAt: new Date(), // expire immediately
        },
      }
    );

    return NextResponse.json({
      success: true,
      message: "Refund initiated successfully. Your account has been reverted to the Free tier.",
      refundId,
    });
  } catch (error) {
    console.error("Refund API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
