import { NextResponse } from "next/server";
import Subscription from "@/models/Subscription";
import {
  computeWebhookEventId,
  createBaseFollowupSubscription,
  createSubscriptionInvoiceIfMissing,
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
        const amountPaise =
          typeof paymentEntity?.amount === "number"
            ? Number(paymentEntity.amount)
          : subscription.offerApplied && Number(subscription.metadata?.offerAmount) > 0
            ? Number(subscription.metadata?.offerAmount)
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
        subscription.status = "completed";

        if (subscription.offerApplied && (subscription.chargeCount ?? 0) === 1) {
          const existingBase = await Subscription.findOne({
            userId: subscription.userId,
            offerSubscriptionId: subscription.subscription_id,
            baseSubscriptionId: { $ne: null },
          });

          if (!existingBase && subscription.subscription_id) {
            const followup = await createBaseFollowupSubscription({
              userId: subscription.userId,
              offerSubscriptionId: subscription.subscription_id,
              planSlug: subscription.planSlug,
            });

            subscription.baseSubscriptionId = followup.subscription.subscription_id;
            subscription.metadata = {
              ...subscription.metadata,
              followupAuthorizationUrl:
                followup.razorpaySubscription.short_url || null,
            };

            await syncUserSubscriptionState({
              userId: subscription.userId,
              subscriptionDocId: followup.subscription._id,
              status: "past_due",
              expiresAt: subscription.current_period_end || subscription.endDate || null,
              autopayActive: false,
            });
          }
        }

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
