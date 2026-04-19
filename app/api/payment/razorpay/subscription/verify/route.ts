import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";

export async function POST(req: Request) {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = await req.json();

    const sign = razorpay_payment_id + "|" + razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(sign.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    await dbConnect();

    // Mark as authenticated (awaiting first charge usually)
    await Subscription.findOneAndUpdate(
      { subscription_id: razorpay_subscription_id },
      { $set: { status: "authenticated", updateAt: new Date() } }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Razorpay Subscription Verification Error:", error);
    return NextResponse.json({ error: error.message || "Verification failed" }, { status: 500 });
  }
}
