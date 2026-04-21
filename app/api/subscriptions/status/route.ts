import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import {
  getCurrentSubscriptionForUser,
  getNextBillingAmount,
} from "@/lib/subscriptions/service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscription = await getCurrentSubscriptionForUser(session.user.id);
    if (!subscription) {
      return NextResponse.json({
        status: "none",
        subscription: null,
        currentPeriodEnd: null,
        offerApplied: false,
        nextBillingAmount: null,
      });
    }

    return NextResponse.json({
      status: subscription.status,
      subscription: {
        id: subscription._id.toString(),
        subscriptionId: subscription.subscription_id,
        offerSubscriptionId: subscription.offerSubscriptionId || null,
        baseSubscriptionId: subscription.baseSubscriptionId || null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
        authorizationUrl:
          typeof subscription.metadata?.authorizationUrl === "string"
            ? subscription.metadata.authorizationUrl
            : null,
      },
      currentPeriodEnd: subscription.current_period_end || subscription.endDate || null,
      offerApplied: subscription.offerApplied || false,
      nextBillingAmount: getNextBillingAmount({
        offerApplied: subscription.offerApplied,
        chargeCount: subscription.chargeCount,
        basePlanAmount: Number(subscription.metadata?.basePlanAmount) || undefined,
        offerAmount: Number(subscription.metadata?.offerAmount) || undefined,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
