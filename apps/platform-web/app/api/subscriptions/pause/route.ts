import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { pauseSubscriptionSchema } from "@/lib/billing/validation/schemas";
import { parseJson, jsonError } from "@/lib/billing/http";
import { pauseSubscription } from "@/lib/billing/subscriptions";
import {
  cachedResponse,
  withIdempotency,
} from "@/lib/billing/idempotency";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const input = await parseJson(request, pauseSubscriptionSchema);

    const idempotency = await withIdempotency({
      request,
      userId,
      route: "subscriptions.pause",
      body: input,
    });
    const replay = cachedResponse(idempotency);
    if (replay) return replay;

    const result = await pauseSubscription({
      userId,
      subscriptionId: input.subscriptionId,
      actorType: "user",
      actorId: userId,
    });

    const body = { success: true, status: result.status };
    await idempotency.complete(200, body);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
