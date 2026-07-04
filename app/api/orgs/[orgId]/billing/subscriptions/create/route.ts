import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import razorpay from "@/lib/razorpay";
import Subscription from "@/models/Subscription";
import { assertOrgMemberRole } from "@/lib/orgs/access";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { getOrgRecurringPlanContext } from "@/lib/orgs/billing/orgPlans";
import { countNonGuestMembers } from "@/lib/orgs/billing/seats";
import { BillingError, jsonError } from "@/lib/billing/http";
import { cachedResponse, withIdempotency } from "@/lib/billing/idempotency";
import { cleanNotes } from "@/lib/payment/razorpayUtils";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import type { BillingCycle } from "@/types/pricing";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

/**
 * POST /api/orgs/[orgId]/billing/subscriptions/create
 *
 * Creates a Razorpay recurring subscription attributed to the organization.
 * The payer is the acting owner/admin (their UPI mandate); the subscription is
 * tagged with `accountId = org:{orgId}` so the webhook routes state changes to
 * `syncOrgSubscriptionState`. No DB write happens here — the Subscription /
 * OrgUsage docs are created only after the webhook confirms payment.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;

    // Billing is owner/admin only (matches the org access-control matrix).
    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin"],
    });

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const planSlug = typeof body.planSlug === "string" ? body.planSlug : "";
    const billingCycle = (
      typeof body.billingCycle === "string" ? body.billingCycle : "monthly"
    ) as BillingCycle;
    const requestedSeats = Number(body.seats);

    const idempotency = await withIdempotency({
      request,
      userId: ctx.userId,
      route: "orgs.billing.create",
      body: { orgId, planSlug, billingCycle, seats: requestedSeats },
    });
    const replay = cachedResponse(idempotency);
    if (replay) return replay;

    await dbConnect();
    const accountId = orgStorageOwnerId(orgId);

    // One active subscription per org.
    const existing = await Subscription.findOne({
      accountId,
      status: { $in: ["authenticated", "active", "pending", "halted"] },
    });
    if (existing) {
      await idempotency.fail();
      throw new BillingError(
        409,
        "This organization already has an active or pending subscription",
        "org_subscription_exists",
      );
    }

    let planContext;
    try {
      planContext = getOrgRecurringPlanContext(planSlug, billingCycle);
    } catch (err) {
      await idempotency.fail();
      throw new BillingError(
        400,
        err instanceof Error ? err.message : "Invalid organization plan",
        "invalid_org_plan",
      );
    }

    // Seat count must cover current members and stay within the plan ceiling.
    const currentMembers = await countNonGuestMembers(orgId);
    const minSeats = Math.max(1, currentMembers);
    const seats = Number.isInteger(requestedSeats)
      ? requestedSeats
      : minSeats;
    if (seats < minSeats) {
      await idempotency.fail();
      throw new BillingError(
        400,
        `Seats must be at least ${minSeats} to cover current members`,
        "seats_below_members",
      );
    }
    if (planContext.plan.maxSeats !== null && seats > planContext.plan.maxSeats) {
      await idempotency.fail();
      throw new BillingError(
        400,
        `The ${planContext.plan.name} plan supports at most ${planContext.plan.maxSeats} seats`,
        "seats_above_plan_max",
      );
    }

    const baseAmountPaise = planContext.baseAmountPaise;
    const maxTotalCount = billingCycle === "yearly" ? 30 : 360;

    const subscriptionPayload: Record<string, unknown> = {
      plan_id: planContext.pricing.razorpayPlanId,
      total_count: maxTotalCount,
      quantity: seats,
      customer_notify: true,
      notes: cleanNotes({
        accountId,
        orgId,
        userId: ctx.userId,
        planSlug: planContext.plan.slug,
        planName: planContext.plan.name,
        billingCycle,
        seats: String(seats),
        basePlanAmount: String(baseAmountPaise),
        firstCycleAmount: String(baseAmountPaise),
      }),
    };

    const razorpaySubscription = await razorpay.subscriptions.create(
      subscriptionPayload as never,
    );

    const responseBody = {
      subscriptionId: razorpaySubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: razorpaySubscription.short_url,
      seats,
      amount: baseAmountPaise / 100,
      planSlug: planContext.plan.slug,
      billingCycle,
    };
    await emitActivity({
      orgId,
      action: ActivityAction.BILLING_CHECKOUT_STARTED,
      actorUserId: ctx.userId,
      target: { type: "subscription", id: razorpaySubscription.id },
      metadata: { planSlug: planContext.plan.slug, billingCycle, seats },
    });

    await idempotency.complete(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    return jsonError(error);
  }
}
