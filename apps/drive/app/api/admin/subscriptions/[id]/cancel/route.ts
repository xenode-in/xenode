import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import { cancelSubscription } from "@/lib/billing/subscriptions";
import { jsonError, BillingError } from "@/lib/billing/http";
import { cachedResponse, withIdempotency } from "@/lib/billing/idempotency";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let idempotency: Awaited<ReturnType<typeof withIdempotency>> | undefined;
  try {
    await dbConnect();
    const { id } = await params;
    const subscription = await Subscription.findById(id);
    if (!subscription?.subscription_id) throw new BillingError(404, "Subscription not found", "subscription_missing");
    idempotency = await withIdempotency({ request, userId: admin.id, route: `admin/subscriptions/${id}/cancel`, body: {} });
    const cached = cachedResponse(idempotency);
    if (cached) return cached;
    await cancelSubscription({
      userId: subscription.userId, accountId: subscription.accountId ?? subscription.userId,
      subscriptionId: subscription.subscription_id, cancelAtPeriodEnd: false,
      actorType: "admin", actorId: admin.id,
    });
    const result = { success: true };
    await idempotency.complete(200, result);
    return NextResponse.json(result);
  } catch (error) {
    await idempotency?.fail();
    return jsonError(error);
  }
}
