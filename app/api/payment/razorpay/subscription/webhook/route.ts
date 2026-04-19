import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import Usage from "@/models/Usage";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Payment from "@/models/Payment";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    await dbConnect();

    const subEntity = event.payload.subscription?.entity;
    const paymentEntity = event.payload.payment?.entity;

    switch (event.event) {
      case "subscription.authenticated":
        await Subscription.findOneAndUpdate(
          { subscription_id: subEntity.id },
          { $set: { status: "authenticated", mandate_status: "approved" } }
        );
        break;

      case "subscription.activated":
        await Subscription.findOneAndUpdate(
          { subscription_id: subEntity.id },
          { 
            $set: { 
              status: "active", 
              current_period_start: new Date(subEntity.current_start * 1000),
              current_period_end: new Date(subEntity.current_end * 1000),
              paid_count: subEntity.paid_count,
            } 
          }
        );
        // Extend user plan access
        if (subEntity.notes?.userId) {
          await Usage.findOneAndUpdate(
            { userId: subEntity.notes.userId },
            { $set: { planExpiresAt: new Date(subEntity.current_end * 1000) } }
          );
        }
        break;

      case "subscription.charged":
        // Record the invoice/payment success
        await SubscriptionInvoice.create({
          subscription_id: subEntity.id,
          payment_id: paymentEntity.id,
          amount: paymentEntity.amount / 100,
          status: "paid",
          billing_date: new Date(),
        });

        await Subscription.findOneAndUpdate(
          { subscription_id: subEntity.id },
          { 
            $set: { 
              paid_count: subEntity.paid_count,
              current_period_start: new Date(subEntity.current_start * 1000),
              current_period_end: new Date(subEntity.current_end * 1000),
            } 
          }
        );
        break;

      case "subscription.cancelled":
        await Subscription.findOneAndUpdate(
          { subscription_id: subEntity.id },
          { $set: { status: "cancelled" } }
        );
        break;

      case "subscription.completed":
        await Subscription.findOneAndUpdate(
          { subscription_id: subEntity.id },
          { $set: { status: "completed" } }
        );
        break;

      default:
        console.log("Unhandled Razorpay Subscription Webhook Event:", event.event);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Razorpay Subscription Webhook Error:", error);
    return NextResponse.json({ error: error.message || "Webhook handling failed" }, { status: 500 });
  }
}
