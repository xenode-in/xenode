import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    await dbConnect();

    // Handle events
    switch (event.event) {
      case "payment.captured":
        const paymentData = event.payload.payment.entity;
        await Payment.findOneAndUpdate(
          { order_id: paymentData.order_id },
          { 
            $set: { 
              status: "success", 
              payment_id: paymentData.id,
              method: paymentData.method,
            } 
          }
        );
        break;

      case "payment.failed":
        const failedPaymentData = event.payload.payment.entity;
        await Payment.findOneAndUpdate(
          { order_id: failedPaymentData.order_id },
          { $set: { status: "failed", notes: failedPaymentData.error_description } }
        );
        break;

      case "order.paid":
        const orderData = event.payload.order.entity;
        // Optionally finalize order logic here if not already done in verify
        break;

      default:
        console.log("Unhandled Razorpay Webhook Event:", event.event);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Razorpay Webhook Error:", error);
    return NextResponse.json({ error: error.message || "Webhook handling failed" }, { status: 500 });
  }
}
