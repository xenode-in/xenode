import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import WebhookLog from "@/models/WebhookLog";
import { dispatchWebhookEvent } from "@/lib/billing/webhooks/handlers";
import { BillingEventType, emitBillingEvent } from "@/lib/billing/events";

/**
 * POST /api/admin/billing/webhooks/[id]/replay
 *
 * Re-runs the original handler for a stored webhook payload. Safe because
 * every handler is idempotent (Payment / Subscription / Coupon redemptions
 * dedupe by gateway IDs). On failure, the WebhookLog row is flipped back to
 * "failed" with the new error so the admin can iterate.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  await dbConnect();
  const log = await WebhookLog.findById(id);
  if (!log) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await dispatchWebhookEvent({
      eventId: log.eventId,
      eventType: log.eventType,
      event: log.payload,
      source:
        log.gateway === "razorpay" ? "razorpay" : "razorpay_subscription",
    });

    log.status = result.status === "failed" ? "failed" : result.status;
    log.errorMessage = result.message ?? undefined;
    await log.save();

    await emitBillingEvent({
      type: BillingEventType.WEBHOOK_REPLAYED,
      actorType: "admin",
      actorId: session.id,
      subjectType: "webhook",
      subjectId: log.eventId,
      payload: {
        eventType: log.eventType,
        status: result.status,
        message: result.message ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      status: result.status,
      message: result.message ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Replay handler threw";
    log.status = "failed";
    log.errorMessage = message;
    await log.save();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
