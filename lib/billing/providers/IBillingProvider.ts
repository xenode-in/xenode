import type { BillingCycle } from "@/types/pricing";

/**
 * IBillingProvider — the boundary between billing service code and the
 * payment gateway SDK. Today only RazorpayProvider implements it; the
 * interface exists so a future Stripe / Paddle / LemonSqueezy provider can
 * be slotted in without refactoring services.
 *
 * Scope is intentionally minimal — only the operations our services already
 * need. Resist the urge to add methods speculatively. New methods go here
 * when a second provider needs them, not before.
 */

export interface ProviderCreateSubscriptionArgs {
  /** Gateway-specific plan identifier (e.g. Razorpay plan_id). */
  planId: string;
  /** Total cycles to charge (Razorpay requires ≥ 1, even for "indefinite"). */
  totalCount: number;
  quantity?: number;
  /** Gateway-specific offer identifier for native discounts. */
  offerId?: string | null;
  /** Free-form notes round-tripped on every webhook. Keep IDs and slugs here. */
  notes?: Record<string, string>;
  /** 1 = gateway notifies customer; 0 = silent. */
  customerNotify?: 0 | 1;
}

export interface ProviderSubscriptionCreated {
  /** Gateway subscription id (Razorpay: sub_xxx). */
  id: string;
  /** Short-url the customer visits to authorise the mandate. */
  shortUrl?: string | null;
  status: string;
}

export interface ProviderSubscriptionState {
  id: string;
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  paidCount?: number;
}

export interface ProviderChangePlanArgs {
  subscriptionId: string;
  newPlanId: string;
  scheduleAt: "now" | "cycle_end";
}

export interface ProviderVerifyWebhookArgs {
  rawBody: string;
  signature: string;
  /** Some gateways send different secrets per event family. */
  eventTypeHint?: string;
}

export interface IBillingProvider {
  readonly name: "razorpay" | "stripe" | "paddle";

  // ── Subscriptions ──────────────────────────────────────────────────────
  createSubscription(
    args: ProviderCreateSubscriptionArgs,
  ): Promise<ProviderSubscriptionCreated>;

  fetchSubscription(id: string): Promise<ProviderSubscriptionState>;

  cancelSubscription(
    id: string,
    args: { cancelAtPeriodEnd: boolean },
  ): Promise<void>;

  pauseSubscription(id: string): Promise<void>;
  resumeSubscription(id: string): Promise<void>;

  changeSubscriptionPlan(args: ProviderChangePlanArgs): Promise<void>;

  // ── Webhooks ───────────────────────────────────────────────────────────
  verifyWebhookSignature(args: ProviderVerifyWebhookArgs): boolean;
}

export interface ProviderPaymentRefundArgs {
  paymentId: string;
  amountPaise?: number;
  reason?: string;
}

export interface IBillingProviderWithRefunds extends IBillingProvider {
  refundPayment(args: ProviderPaymentRefundArgs): Promise<{ refundId: string }>;
}

/** Resolved at runtime by the registry — single export point for services. */
export type AnyBillingProvider = IBillingProvider | IBillingProviderWithRefunds;

/** Subscription billing cycles a provider must understand. */
export type ProviderBillingCycle = BillingCycle;
