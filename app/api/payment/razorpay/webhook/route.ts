import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import WebhookLog from "@/models/WebhookLog";
import {
  verifyRazorpaySignature,
  paymentLogger,
} from "@/lib/payment/razorpayUtils";
import { dispatchWebhookEvent } from "@/lib/billing/webhooks/handlers";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";

/**
 * Unified Razorpay webhook endpoint.
 *
 * Security & idempotency contract (in order):
 *   1. Read raw body and `x-razorpay-signature` header.
 *   2. Verify HMAC-SHA256 against BOTH the order/payment secret and the
 *      subscription secret (Razorpay sends both kinds of events to the same
 *      URL when configured that way). If neither verifies, 401 — no DB writes.
 *   3. Compute a stable eventId (event.id from payload, fall back to body hash).
 *   4. Upsert a WebhookLog row keyed by eventId. If already `processed`, return
 *      200 immediately (replay). If `failed`, allow retry.
 *   5. Dispatch via `lib/billing/webhooks/handlers.ts`. Mark log accordingly.
 *
 * Razorpay retries on non-2xx for ~24h. Returning 2xx for verified-but-
 * unhandled events stops retries; returning 4xx/5xx for failures keeps them.
 */

const SUBSCRIPTION_EVENT_PREFIXES = [
  "subscription.",
  "payment.dispute.",
  "invoice.",
];

function computeEventId(rawBody: string, parsed: any): string {
  const explicit =
    (typeof parsed?.id === "string" && parsed.id) ||
    (typeof parsed?.event_id === "string" && parsed.event_id);
  if (explicit) return explicit;
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

function verifyAgainstEitherSecret(
  rawBody: string,
  signature: string,
  eventType: string,
): boolean {
  const isSubscriptionEvent = SUBSCRIPTION_EVENT_PREFIXES.some((p) =>
    eventType.startsWith(p),
  );

  const orderSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  const subSecret =
    process.env.RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET || orderSecret;

  // Prefer the matching secret first, then fall back.
  const primary = isSubscriptionEvent ? subSecret : orderSecret;
  const fallback = isSubscriptionEvent ? orderSecret : subSecret;

  return (
    verifyRazorpaySignature(rawBody, signature, primary) ||
    (fallback !== primary &&
      verifyRazorpaySignature(rawBody, signature, fallback))
  );
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";

  if (!rawBody || !signature) {
    return NextResponse.json(
      { error: "Missing body or signature" },
      { status: 400 },
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType: string =
    typeof parsed?.event === "string" ? parsed.event : "unknown";

  // 1. Verify signature BEFORE any DB write. Tampered events never land in the log.
  if (!verifyAgainstEitherSecret(rawBody, signature, eventType)) {
    paymentLogger.error(`Razorpay webhook signature failed (${eventType})`);
    // Fire-and-forget audit (does not log payload to avoid amplifying junk).
    await emitBillingEvent({
      type: BillingEventType.WEBHOOK_INVALID_SIGNATURE,
      actorType: "webhook",
      actorId: null,
      subjectType: "webhook",
      payload: { eventType },
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  await dbConnect();
  const eventId = computeEventId(rawBody, parsed);

  // 2. Upsert log keyed by eventId. Atomically detect first-seen vs replay.
  const upsert = await WebhookLog.findOneAndUpdate(
    { eventId },
    {
      $setOnInsert: {
        eventId,
        eventType,
        gateway: "razorpay",
        payload: parsed,
        status: "pending",
      },
    },
    { upsert: true, new: true, includeResultMetadata: true },
  );

  // includeResultMetadata returns { value, lastErrorObject }
  const inserted = !!(upsert as any)?.lastErrorObject?.upserted;
  const log = (upsert as any)?.value ?? upsert;

  if (!inserted && log?.status === "processed") {
    paymentLogger.info(`Replay of processed webhook ${eventId} — short-circuit`);
    return NextResponse.json({ success: true, replay: true });
  }

  // 3. Dispatch.
  try {
    const result = await dispatchWebhookEvent({
      eventId,
      eventType,
      event: parsed,
      source: "razorpay",
    });

    await WebhookLog.updateOne(
      { eventId },
      {
        $set: {
          status: result.status === "failed" ? "failed" : result.status,
          errorMessage: result.message ?? null,
        },
      },
    );

    if (result.status === "failed") {
      return NextResponse.json(
        { error: result.message ?? "Handler failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true, handled: result.status });
  } catch (error: any) {
    paymentLogger.error("Webhook dispatch threw", error);
    await WebhookLog.updateOne(
      { eventId },
      { $set: { status: "failed", errorMessage: error?.message } },
    );
    return NextResponse.json(
      { error: error?.message ?? "Internal error" },
      { status: 500 },
    );
  }
}
