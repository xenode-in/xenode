import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import WebhookLog from "@/models/WebhookLog";
import {
  verifyRazorpaySignature,
  paymentLogger,
} from "@/lib/payment/razorpayUtils";
import { fulfillOrder, processRefund } from "@/lib/payment/fulfillmentService";
import Payment from "@/models/Payment";

export async function POST(req: Request) {
  let webhookLogId: string | null = null;

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") || "";
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";

    // 1. Basic Validation
    if (!rawBody || !signature) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event;
    const eventId = event.id;

    await dbConnect();

    // 2. Log Entry (Pre-processing)
    const log = await WebhookLog.create({
      eventId,
      eventType,
      gateway: "razorpay",
      payload: event,
      status: "pending",
    });
    webhookLogId = log._id as any;

    // 3. Signature Verification
    if (!verifyRazorpaySignature(rawBody, signature, secret)) {
      paymentLogger.error(`Invalid signature for webhook event ${eventId}`);
      await WebhookLog.findByIdAndUpdate(webhookLogId, {
        status: "failed",
        errorMessage: "Invalid signature",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // 4. Event Dispatching
    paymentLogger.info(
      `Processing Razorpay Webhook [${eventType}] - ${eventId}`,
    );

    switch (eventType) {
      case "payment.captured":
      case "order.paid": {
        const paymentData =
          event.payload.payment?.entity || event.payload.order?.entity;
        const orderId = paymentData.order_id || paymentData.id;
        const paymentId = paymentData.id || event.payload.payment?.entity?.id;

        const result = await fulfillOrder(orderId, paymentId, event);
        if (result.success) {
          await WebhookLog.findByIdAndUpdate(webhookLogId, {
            status: "processed",
          });
        } else {
          await WebhookLog.findByIdAndUpdate(webhookLogId, {
            status: "failed",
            errorMessage: result.error,
          });
        }
        break;
      }

      case "refund.processed": {
        const refundData = event.payload.refund.entity;
        const paymentId = refundData.payment_id;
        const refundId = refundData.id;

        const result = await processRefund(paymentId, refundId, event);
        if (result.success) {
          await WebhookLog.findByIdAndUpdate(webhookLogId, {
            status: "processed",
          });
        } else {
          await WebhookLog.findByIdAndUpdate(webhookLogId, {
            status: "failed",
            errorMessage: result.error,
          });
        }
        break;
      }

      case "payment.failed": {
        const failedData = event.payload.payment.entity;
        const orderId = failedData.order_id;

        await Payment.findOneAndUpdate(
          { order_id: orderId },
          {
            $set: {
              status: "failed",
              gatewayResponse: event,
              metadata: { error_description: failedData.error_description },
            },
          },
          { upsert: true },
        );
        await WebhookLog.findByIdAndUpdate(webhookLogId, {
          status: "processed",
        });
        break;
      }

      default:
        paymentLogger.info(`Ignoring unhandled webhook event: ${eventType}`);
        await WebhookLog.findByIdAndUpdate(webhookLogId, { status: "ignored" });
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    paymentLogger.error("Webhook processing error", error);
    if (webhookLogId) {
      await WebhookLog.findByIdAndUpdate(webhookLogId, {
        status: "failed",
        errorMessage: error.message,
      });
    }
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: 500 },
    );
  }
}
