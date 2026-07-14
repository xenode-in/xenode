import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { cancelSubscriptionSchema } from "@/lib/billing/validation/schemas";
import { parseJson, jsonError } from "@/lib/billing/http";
import { cancelSubscription } from "@/lib/billing/subscriptions";
import {
  cachedResponse,
  withIdempotency,
} from "@/lib/billing/idempotency";
import { captureEvent } from "@/lib/posthog";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const input = await parseJson(request, cancelSubscriptionSchema);

    const idempotency = await withIdempotency({
      request,
      userId,
      route: "subscriptions.cancel",
      body: input,
    });
    const replay = cachedResponse(idempotency);
    if (replay) return replay;

    const result = await cancelSubscription({
      userId,
      subscriptionId: input.subscriptionId,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      actorType: "user",
      actorId: userId,
    });

    const body = {
      success: true,
      status: result.status,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      alreadyCancelled: result.alreadyCancelled,
    };
    captureEvent(userId, "subscription_cancelled", {
      source: "web",
    });
    await idempotency.complete(200, body);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
