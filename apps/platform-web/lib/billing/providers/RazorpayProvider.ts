import razorpay from "@/lib/razorpay";
import {
  cleanNotes,
  verifyRazorpaySignature,
} from "@/lib/payment/razorpayUtils";
import type {
  IBillingProviderWithRefunds,
  ProviderChangePlanArgs,
  ProviderCreateSubscriptionArgs,
  ProviderPaymentRefundArgs,
  ProviderSubscriptionCreated,
  ProviderSubscriptionState,
  ProviderVerifyWebhookArgs,
} from "./IBillingProvider";

/**
 * RazorpayProvider — thin wrapper over the Razorpay SDK conforming to
 * IBillingProviderWithRefunds. Existing service code (`subscriptions/create`,
 * `lib/billing/subscriptions.ts`, webhook handlers) still call the SDK
 * directly today; this adapter is the migration target so when we slot in
 * a second provider we have exactly one place to swap.
 *
 * Do NOT add Razorpay-specific quirks above the interface — push them into
 * the args / response mapping so the boundary stays clean.
 */

const SUBSCRIPTION_EVENT_PREFIXES = ["subscription.", "payment.dispute."];

class RazorpayProvider implements IBillingProviderWithRefunds {
  readonly name = "razorpay" as const;

  async createSubscription(
    args: ProviderCreateSubscriptionArgs,
  ): Promise<ProviderSubscriptionCreated> {
    const payload: Record<string, unknown> = {
      plan_id: args.planId,
      total_count: args.totalCount,
      quantity: args.quantity ?? 1,
      // Razorpay docs (Jan 2026): customer_notify is a boolean (true/false).
      customer_notify:
        args.customerNotify == null ? true : Boolean(args.customerNotify),
      notes: cleanNotes(args.notes ?? {}),
    };
    if (args.offerId) payload.offer_id = args.offerId;

    const sub = await razorpay.subscriptions.create(payload as never);
    return {
      id: sub.id,
      shortUrl: sub.short_url ?? null,
      status: sub.status as string,
    };
  }

  async fetchSubscription(id: string): Promise<ProviderSubscriptionState> {
    const remote = await razorpay.subscriptions.fetch(id);
    return {
      id: remote.id,
      status: remote.status as string,
      currentPeriodStart:
        typeof remote.current_start === "number"
          ? new Date(remote.current_start * 1000)
          : undefined,
      currentPeriodEnd:
        typeof remote.current_end === "number"
          ? new Date(remote.current_end * 1000)
          : undefined,
      paidCount:
        typeof remote.paid_count === "number" ? remote.paid_count : undefined,
    };
  }

  async cancelSubscription(
    id: string,
    args: { cancelAtPeriodEnd: boolean },
  ): Promise<void> {
    await razorpay.subscriptions.cancel(id, {
      cancel_at_cycle_end: args.cancelAtPeriodEnd,
    } as never);
  }

  async pauseSubscription(id: string): Promise<void> {
    await razorpay.subscriptions.pause(id, { pause_at: "now" } as never);
  }

  async resumeSubscription(id: string): Promise<void> {
    await razorpay.subscriptions.resume(id, { resume_at: "now" } as never);
  }

  async changeSubscriptionPlan(args: ProviderChangePlanArgs): Promise<void> {
    await razorpay.subscriptions.update(args.subscriptionId, {
      plan_id: args.newPlanId,
      schedule_change_at: args.scheduleAt === "now" ? "now" : "cycle_end",
      customer_notify: true,
    } as never);
  }

  verifyWebhookSignature(args: ProviderVerifyWebhookArgs): boolean {
    const orderSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
    const subSecret =
      process.env.RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET || orderSecret;
    const isSub = SUBSCRIPTION_EVENT_PREFIXES.some((p) =>
      (args.eventTypeHint ?? "").startsWith(p),
    );
    const primary = isSub ? subSecret : orderSecret;
    const fallback = isSub ? orderSecret : subSecret;
    return (
      verifyRazorpaySignature(args.rawBody, args.signature, primary) ||
      (fallback !== primary &&
        verifyRazorpaySignature(args.rawBody, args.signature, fallback))
    );
  }

  async refundPayment(
    args: ProviderPaymentRefundArgs,
  ): Promise<{ refundId: string }> {
    const refund = await razorpay.payments.refund(args.paymentId, {
      ...(args.amountPaise ? { amount: args.amountPaise } : {}),
      speed: "optimum",
      notes: args.reason ? { reason: args.reason } : undefined,
    } as never);
    return { refundId: refund.id };
  }
}

export const razorpayProvider = new RazorpayProvider();
