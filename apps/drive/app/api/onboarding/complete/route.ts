import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { syncUserSubscriptionState } from "@/lib/subscriptions/service";
import { jsonError } from "@/lib/billing/http";
import { captureEvent } from "@/lib/posthog";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;

    const { usage } = await syncUserSubscriptionState({
      userId, action: "initialize", actor: { actorType: "user", actorId: userId },
    });
    if (!usage) throw new Error("Usage initialization failed");

    captureEvent(userId, "onboarding_completed", {
      planSlug: usage.plan,
      source: "web",
    });

    return NextResponse.json({ success: true, plan: usage.plan, storageLimitBytes: usage.storageLimitBytes });
  } catch (error) {
    return jsonError(error);
  }
}
