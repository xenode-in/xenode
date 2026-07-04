import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { getOrCreateOrgUsage } from "@/lib/orgs/billing/orgUsage";
import { getSeatState } from "@/lib/orgs/billing/seats";
import { ORG_PLANS } from "@/lib/orgs/billing/orgPlans";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * GET /api/orgs/[orgId]/billing — org billing summary for the admin billing UI.
 * Owner/admin only (billing:read). Reads only billing-safe collections.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    await dbConnect();
    const accountId = orgStorageOwnerId(orgId);
    const [usage, subscription, seatState] = await Promise.all([
      getOrCreateOrgUsage(orgId),
      Subscription.findOne({ accountId }).sort({ createdAt: -1 }).lean(),
      getSeatState(orgId),
    ]);

    return NextResponse.json({
      usage: {
        plan: usage.plan,
        storageLimitBytes: usage.storageLimitBytes,
        totalStorageBytes: usage.totalStorageBytes,
        totalObjects: usage.totalObjects,
        seats: usage.seats,
        seatsUsed: seatState.seatsUsed,
        pendingInvites: seatState.pendingInvites,
        planExpiresAt: usage.planExpiresAt,
        isGracePeriod: usage.isGracePeriod,
        gracePeriodEndsAt: usage.gracePeriodEndsAt,
      },
      subscription: subscription
        ? {
            status: subscription.status,
            planSlug: subscription.planSlug,
            billingCycle: subscription.billingCycle,
            currentPeriodEnd:
              subscription.current_period_end ?? subscription.endDate ?? null,
          }
        : null,
      plans: ORG_PLANS.map((plan) => ({
        slug: plan.slug,
        name: plan.name,
        storage: plan.storage,
        maxSeats: plan.maxSeats,
        pricing: plan.pricing.map((p) => ({
          cycle: p.cycle,
          priceINR: p.priceINR,
        })),
        features: plan.features,
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to load org billing";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
