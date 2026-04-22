import { NextResponse } from "next/server";
import Subscription from "@/models/Subscription";
import {
  computeWebhookEventId,
  consumeCouponRedemptionIfNeeded,
  createSubscriptionInvoiceIfMissing,
  createSubscriptionPaymentIfMissing,
  createWebhookLog,
  markWebhookFailed,
  markWebhookProcessed,
  syncUserSubscriptionState,
} from "@/lib/subscriptions/service";
import { verifyRazorpaySignature } from "@/lib/payment/razorpayUtils";

export async function POST(request: Request) {
  const rawBody = await request.text();
  let eventType = "unknown";
  let eventId = "";

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown> & {
      event?: string;
      payload?: {
        subscription?: { entity?: Record<string, unknown> };
        payment?: { entity?: Record<string, unknown> };
      };
    };
    eventType = typeof parsed.event === "string" ? parsed.event : "unknown";
    eventId = computeWebhookEventId(rawBody, parsed);

    const existingLog = await createWebhookLog(eventId, eventType, parsed);
    if (existingLog?.status === "processed") {
      return NextResponse.json({ success: true, duplicate: true });
    }

    const signature = request.headers.get("x-razorpay-signature") || "";
    const verified = verifyRazorpaySignature(
      rawBody,
      signature,
      process.env.RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET || "",
    );

    if (!verified) {
      await markWebhookFailed(eventId, "Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const subEntity = parsed.payload?.subscription?.entity;
    const paymentEntity = parsed.payload?.payment?.entity;
    const razorpaySubscriptionId =
      typeof subEntity?.id === "string" ? subEntity.id : null;

    if (!razorpaySubscriptionId) {
      await markWebhookProcessed(eventId);
      return NextResponse.json({ success: true, ignored: true });
    }

    const subscription = await Subscription.findOne({
      subscription_id: razorpaySubscriptionId,
    });

    if (!subscription) {
      await markWebhookProcessed(eventId);
      return NextResponse.json({ success: true, ignored: true });
    }

    switch (eventType) {
      case "subscription.authenticated": {
        subscription.status = "authenticated";
        subscription.mandate_status = "approved";
        await subscription.save();
        break;
      }

      case "subscription.activated": {
        subscription.status = "active";
        subscription.current_period_start =
          typeof subEntity?.current_start === "number"
            ? new Date(subEntity.current_start * 1000)
          : subscription.current_period_start;
        subscription.current_period_end =
          typeof subEntity?.current_end === "number"
            ? new Date(subEntity.current_end * 1000)
          : subscription.current_period_end;
        subscription.endDate = subscription.current_period_end || subscription.endDate;
        subscription.paid_count =
          typeof subEntity?.paid_count === "number"
            ? subEntity.paid_count
            : subscription.paid_count ?? 0;
        await subscription.save();

        await syncUserSubscriptionState({
          userId: subscription.userId,
          subscriptionDocId: subscription._id,
          status: "active",
          expiresAt: subscription.current_period_end || subscription.endDate,
          autopayActive: true,
        });
        break;
      }

      case "subscription.charged": {
        // Use the payment entity amount as source of truth.
        // Razorpay sends the actual charged amount, which accounts for
        // any offer/plan changes automatically.
        const amountPaise =
          typeof paymentEntity?.amount === "number"
            ? Number(paymentEntity.amount)
            : Number(subscription.metadata?.basePlanAmount) || 99900;

        const invoiceResult =
          typeof paymentEntity?.id === "string"
          ? await createSubscriptionInvoiceIfMissing({
              subscriptionId: razorpaySubscriptionId,
              paymentId: paymentEntity.id,
              amountPaise,
              metadata: {
                eventId,
                source: "subscription.charged",
              },
            })
          : { created: false };

        subscription.status = "active";
        subscription.current_period_start =
          typeof subEntity?.current_start === "number"
            ? new Date(subEntity.current_start * 1000)
          : subscription.current_period_start;
        subscription.current_period_end =
          typeof subEntity?.current_end === "number"
            ? new Date(subEntity.current_end * 1000)
          : subscription.current_period_end;
        subscription.endDate = subscription.current_period_end || subscription.endDate;
        subscription.paid_count =
          typeof subEntity?.paid_count === "number"
            ? subEntity.paid_count
            : subscription.paid_count ?? 0;
        if (invoiceResult.created) {
          subscription.chargeCount = (subscription.chargeCount ?? 0) + 1;
        } else if (typeof subEntity?.paid_count === "number") {
          subscription.chargeCount = Math.max(
            subscription.chargeCount ?? 0,
            Number(subEntity.paid_count),
          );
        }
        await subscription.save();

        if (typeof paymentEntity?.id === "string") {
          await createSubscriptionPaymentIfMissing({
            userId: subscription.userId,
            paymentId: paymentEntity.id,
            subscriptionId: razorpaySubscriptionId,
            planName:
              typeof subscription.metadata?.planName === "string"
                ? subscription.metadata.planName
                : subscription.planSlug,
            billingCycle: subscription.billingCycle,
            amountPaise,
            subscriptionStartDate:
              subscription.current_period_start || subscription.startDate,
            subscriptionEndDate:
              subscription.current_period_end || subscription.endDate,
            method:
              typeof paymentEntity.method === "string"
                ? paymentEntity.method
                : "upi_autopay",
            gatewayResponse: {
              eventId,
              source: "subscription.charged",
              paymentEntity,
            },
          });

          await consumeCouponRedemptionIfNeeded({
            couponId:
              typeof subscription.metadata?.couponId === "string"
                ? subscription.metadata.couponId
                : null,
            userId: subscription.userId,
            txnid: paymentEntity.id,
          });
        }

        await syncUserSubscriptionState({
          userId: subscription.userId,
          subscriptionDocId: subscription._id,
          status: "active",
          expiresAt: subscription.current_period_end || subscription.endDate,
          autopayActive: true,
        });
        break;
      }

      case "subscription.pending": {
        subscription.status = "past_due";
        await subscription.save();

        await syncUserSubscriptionState({
          userId: subscription.userId,
          subscriptionDocId: subscription._id,
          status: "past_due",
          expiresAt: subscription.current_period_end || subscription.endDate || null,
          autopayActive: false,
        });
        break;
      }

      case "subscription.halted": {
        subscription.status = "halted";
        await subscription.save();

        await syncUserSubscriptionState({
          userId: subscription.userId,
          subscriptionDocId: subscription._id,
          status: "halted",
          expiresAt: subscription.current_period_end || subscription.endDate || null,
          autopayActive: false,
        });
        break;
      }

      case "subscription.cancelled": {
        subscription.status = "cancelled";
        subscription.metadata = {
          ...subscription.metadata,
          cancelledAt: new Date().toISOString(),
        };
        await subscription.save();

        await syncUserSubscriptionState({
          userId: subscription.userId,
          subscriptionDocId: subscription._id,
          status: "cancelled",
          expiresAt: subscription.current_period_end || subscription.endDate || null,
          autopayActive: false,
        });
        break;
      }

      case "subscription.completed": {
        // With total_count=0 (unlimited), this event should not fire
        // for new subscriptions. If it does, just mark as completed.
        subscription.status = "completed";
        await subscription.save();
        break;
      }

      default:
        break;
    }

    await markWebhookProcessed(eventId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (eventId) {
      await markWebhookFailed(
        eventId,
        error instanceof Error ? error.message : "Unknown webhook error",
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook handling failed",
      },
      { status: 500 },
    );
  }
}
