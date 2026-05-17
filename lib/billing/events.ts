import dbConnect from "@/lib/mongodb";
import BillingEvent, {
  type BillingEventActorType,
} from "@/models/BillingEvent";

/**
 * Billing event emitter.
 *
 * Writes one row to BillingEvent per call. Fire-and-forget by design — never
 * throws out of `emit()`; failure to persist an audit row must not break the
 * surrounding billing operation. Errors are logged.
 *
 * Payload sanitization: strips known PII keys defensively.
 */

const PII_KEYS = new Set([
  "email",
  "phone",
  "name",
  "firstName",
  "lastName",
  "contact",
  "address",
  "billingAddress",
]);

function sanitize(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { value: payload };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (PII_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export interface EmitArgs {
  type: string;
  userId?: string | null;
  actorType: BillingEventActorType;
  actorId?: string | null;
  subjectType: string;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
}

export async function emitBillingEvent(args: EmitArgs): Promise<void> {
  try {
    await dbConnect();
    await BillingEvent.create({
      type: args.type,
      userId: args.userId ?? null,
      actorType: args.actorType,
      actorId: args.actorId ?? null,
      subjectType: args.subjectType,
      subjectId: args.subjectId ?? null,
      payload: sanitize(args.payload ?? {}),
    });
  } catch (error) {
    // Audit failures must not block billing. Log loudly.
    console.error("[BillingEvent] emit failed", {
      type: args.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Constants for known event types — keeps usage greppable. */
export const BillingEventType = {
  SUBSCRIPTION_CREATED: "subscription.created",
  SUBSCRIPTION_ACTIVATED: "subscription.activated",
  SUBSCRIPTION_CHARGED: "subscription.charged",
  SUBSCRIPTION_PAUSED: "subscription.paused",
  SUBSCRIPTION_RESUMED: "subscription.resumed",
  SUBSCRIPTION_CANCELLED: "subscription.cancelled",
  SUBSCRIPTION_HALTED: "subscription.halted",
  SUBSCRIPTION_PAST_DUE: "subscription.past_due",
  SUBSCRIPTION_COMPLETED: "subscription.completed",
  SUBSCRIPTION_EXPIRED: "subscription.expired",
  SUBSCRIPTION_GRACE_GRANTED: "subscription.grace_granted",

  PAYMENT_CAPTURED: "payment.captured",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_REFUNDED: "payment.refunded",
  PAYMENT_RETRY_NEEDED: "payment.retry_needed",
  PAYMENT_DISPUTE_CREATED: "payment.dispute.created",

  COUPON_REDEEMED: "coupon.redeemed",
  COUPON_REJECTED: "coupon.rejected",

  WEBHOOK_RECEIVED: "webhook.received",
  WEBHOOK_REPLAYED: "webhook.replayed",
  WEBHOOK_INVALID_SIGNATURE: "webhook.invalid_signature",

  ADMIN_PLAN_UPDATED: "admin.plan.updated",
  ADMIN_CAMPAIGN_CREATED: "admin.campaign.created",
  ADMIN_COUPON_CREATED: "admin.coupon.created",
  ADMIN_SUBSCRIPTION_CANCELLED: "admin.subscription.cancelled",
} as const;
