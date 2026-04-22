import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import { PricingConfig } from "@/models/PricingConfig";
import { createRazorpayRecurringPlan } from "@/lib/subscriptions/service";
import type { BillingCycle } from "@/types/pricing";

/**
 * POST /api/admin/subscriptions/plans/create
 *
 * Creates real Razorpay plans for the specified plan slug and billing cycles,
 * then updates the PricingConfig document with the returned plan IDs.
 *
 * Body: { planSlug: "plus", cycles?: ["monthly", "yearly"] }
 *       If cycles is omitted, creates plans for ALL cycles that have priceINR > 0.
 *
 * Or to create ALL plans at once: { all: true }
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const body = await request.json().catch(() => ({}));
  const createAll = body.all === true;
  const planSlug = typeof body.planSlug === "string" ? body.planSlug : "";
  const requestedCycles = Array.isArray(body.cycles) ? body.cycles : null;

  const pricingConfig = await PricingConfig.findOne();
  if (!pricingConfig) {
    return NextResponse.json(
      { error: "Pricing configuration not found" },
      { status: 404 },
    );
  }

  const targetPlans = createAll
    ? pricingConfig.plans
    : pricingConfig.plans.filter(
        (p: { slug: string }) => p.slug === planSlug,
      );

  if (targetPlans.length === 0) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const results: Array<{
    slug: string;
    cycle: string;
    razorpayPlanId: string;
    amountINR: number;
  }> = [];

  for (const plan of targetPlans) {
    const pricingEntries = plan.pricing.filter(
      (entry: { cycle: string; priceINR: number; razorpayPlanId?: string }) => {
        if (entry.priceINR <= 0) return false;
        if (requestedCycles && !requestedCycles.includes(entry.cycle))
          return false;
        // Skip if already has a real Razorpay plan ID
        if (
          entry.razorpayPlanId &&
          !entry.razorpayPlanId.includes("_1") &&
          entry.razorpayPlanId.length > 15
        )
          return false;
        return true;
      },
    );

    for (const entry of pricingEntries) {
      const cycle = entry.cycle as BillingCycle;
      if (cycle === "lifetime") continue;

      const amountPaise = Math.round(entry.priceINR * 100);

      const razorpayPlan = await createRazorpayRecurringPlan({
        amountPaise,
        name: `Xenode ${plan.name} (${cycle})`,
        billingCycle: cycle,
        description: `${plan.name} plan - ${cycle} billing`,
      });

      // Update the pricing config in-place
      entry.razorpayPlanId = razorpayPlan.id;

      results.push({
        slug: plan.slug,
        cycle: entry.cycle,
        razorpayPlanId: razorpayPlan.id,
        amountINR: entry.priceINR,
      });
    }
  }

  // Save updated pricing config with real Razorpay plan IDs
  pricingConfig.markModified("plans");
  await pricingConfig.save();

  return NextResponse.json({
    success: true,
    created: results.length,
    plans: results,
  });
}
