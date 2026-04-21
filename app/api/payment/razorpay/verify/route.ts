import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import { fulfillOrder } from "@/lib/payment/fulfillmentService";

export async function POST(req: Request) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Signature Verification
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(sign.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    await dbConnect();

    // 2. Centralized Fulfillment
    // We use the fulfillmentService to ensure that the logic is identical 
    // whether it's triggered from here (client-side) or the webhook (server-side).
    const result = await fulfillOrder(
      razorpay_order_id,
      razorpay_payment_id,
      { 
        method: "razorpay_manual_verify",
        razorpay_signature 
      }
    );

    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || "Fulfillment failed" 
      }, { status: result.error === "Pending transaction not found" ? 404 : 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Payment verified and plan activated",
      alreadyProcessed: result.alreadyProcessed
    });
  } catch (error: any) {
    console.error("Razorpay Verification Error:", error);
    return NextResponse.json(
      { error: error.message || "Verification failed" },
      { status: 500 }
    );
  }
}
