import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription from "@/models/Subscription";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { getOrgPlanBySlug } from "@/lib/orgs/billing/orgPlans";
import { countNonGuestMembers } from "@/lib/orgs/billing/seats";
import { calculateProration } from "@/lib/billing/proration";
import { BillingError, jsonError } from "@/lib/billing/http";
import type { BillingCycle } from "@/types/pricing";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * PATCH /api/orgs/[orgId]/billing/seats — change the purchased seat count.
 *
 * Updates the Razorpay subscription quantity. OrgUsage.seats is updated by the
 * `subscription.updated` webhook (single mutation point), not here. Returns an
 * informational proration preview.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 1) {
      throw new BillingError(400, "seats must be a positive integer", "invalid_seats");
    }

    await dbConnect();
    const accountId = orgStorageOwnerId(orgId);
    const subscription = await Subscription.findOne({
      accountId,
      status: { $in: ["active", "authenticated"] },
    }).sort({ createdAt: -1 });

    if (!subscription || !subscription.subscription_id) {
      throw new BillingError(
        404,
        "No active organization subscription to change",
        "org_subscription_not_found",
      );
    }

    const plan = getOrgPlanBySlug(subscription.planSlug);
    if (!plan) {
      throw new BillingError(400, "Unknown organization plan", "invalid_org_plan");
    }

    const currentMembers = await countNonGuestMembers(orgId);
    if (seats < Math.max(1, currentMembers)) {
      throw new BillingError(
        400,
        `Seats must be at least ${Math.max(1, currentMembers)} to cover current members`,
        "seats_below_members",
      );
    }
    if (plan.maxSeats !== null && seats > plan.maxSeats) {
      throw new BillingError(
        400,
        `The ${plan.name} plan supports at most ${plan.maxSeats} seats`,
        "seats_above_plan_max",
      );
    }

    const cycle = subscription.billingCycle as BillingCycle;
    const pricing = plan.pricing.find((p) => p.cycle === cycle);
    const perSeatINR = pricing?.priceINR ?? 0;
    const previousSeats =
      typeof subscription.metadata?.seats === "number"
        ? subscription.metadata.seats
        : Number(subscription.metadata?.seats) || currentMembers;

    let proration = null;
    if (
      perSeatINR > 0 &&
      subscription.current_period_start &&
      subscription.current_period_end
    ) {
      proration = calculateProration({
        currentPlanPriceINR: perSeatINR * previousSeats,
        currentCycle: cycle,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        newPlanPriceINR: perSeatINR * seats,
      });
    }

    await razorpay.subscriptions.update(subscription.subscription_id, {
      quantity: seats,
    } as never);

    // Record intent on the sub doc; OrgUsage.seats applies on subscription.updated.
    subscription.metadata = {
      ...subscription.metadata,
      pendingSeats: seats,
    };
    await subscription.save();

    return NextResponse.json({ seats, proration });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    return jsonError(error);
  }
}
