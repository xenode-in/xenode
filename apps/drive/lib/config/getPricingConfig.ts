/**
 * getPricingConfig.ts — DB-backed source of truth for all Xenode plan definitions.
 *
 * REFACTORED (multi-cycle):
 *   - Default seeds now include monthly + yearly pricing per plan.
 *   - getPlanConfigFromDB() accepts a BillingCycle param.
 *   - All price math delegated to lib/pricing/pricingService.ts.
 *
 * Used by:
 *  - app/api/payment/payu/route.ts  (server-authoritative pricing)
 *  - components/PricingComparison.tsx (public pricing page)
 *  - app/(onboarding)/onboarding/OnboardingForm.tsx (plan picker)
 *
 * NEVER derive plan prices or limits from client input.
 */

import dbConnect from "@/lib/mongodb";
import { PricingConfig, IPlan } from "@/models/PricingConfig";
import type { BillingCycle } from "@/types/pricing";

// ─── Default seed data ───────────────────────────────────────────────────────
// Yearly price = monthly × 10 (≈ 2 months free, ~17% saving)

const DEFAULT_PLANS: IPlan[] = [
  {
    name: "Basic",
    slug: "basic",
    storage: "100 GB",
    storageLimitBytes: 100 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 149 },
      { cycle: "yearly", priceINR: 1490 },
    ],
    features: [
      "100 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "Pro",
    slug: "pro",
    storage: "500 GB",
    storageLimitBytes: 500 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 399, razorpayPlanId: "plan_ProMonthly_1" },
      {
        cycle: "yearly",
        priceINR: 3990,
        razorpayPlanId: "plan_ProYearly_1",
      },
    ],
    features: [
      "500 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "Plus",
    slug: "plus",
    storage: "1 TB",
    storageLimitBytes: 1024 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 699, razorpayPlanId: "plan_PlusMonthly_1" },
      {
        cycle: "yearly",
        priceINR: 6990,
        razorpayPlanId: "plan_PlusYearly_1",
      },
    ],
    isPopular: true,
    features: [
      "1 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
  {
    name: "Max",
    slug: "max",
    storage: "2 TB",
    storageLimitBytes: 2 * 1024 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 999, razorpayPlanId: "plan_MaxMonthly_1" },
      {
        cycle: "yearly",
        priceINR: 9990,
        razorpayPlanId: "plan_MaxYearly_1",
      },
    ],
    features: [
      "2 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PricingData {
  plans: IPlan[];
}

// ─── Core fetcher ─────────────────────────────────────────────────────────────

/** Server-only. Fetches from DB, seeds defaults on first call. */
export async function getPricingConfig(): Promise<PricingData> {
  await dbConnect();

  let config = await PricingConfig.findOne().lean();

  if (!config) {
    config = await PricingConfig.create({
      plans: DEFAULT_PLANS,
      updatedBy: "system",
    });
  }

  return {
    plans: config.plans as IPlan[],
  };
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

/** Returns plan by slug. Used in checkout pages. */
export async function getPlanBySlugFromDB(
  slug: string,
): Promise<IPlan | undefined> {
  const { plans } = await getPricingConfig();
  return plans.find((p) => p.slug === slug);
}

/**
 * Reverse lookup: find the plan + cycle that owns a given razorpayPlanId.
 * Used by the subscription.updated webhook to translate Razorpay's plan id
 * back into our planSlug after a period-end plan change.
 */
export async function getPlanByRazorpayPlanIdFromDB(
  razorpayPlanId: string,
): Promise<{ plan: IPlan; cycle: BillingCycle } | undefined> {
  if (!razorpayPlanId) return undefined;
  const { plans } = await getPricingConfig();
  for (const plan of plans) {
    const match = plan.pricing.find((p) => p.razorpayPlanId === razorpayPlanId);
    if (match) return { plan, cycle: match.cycle };
  }
  return undefined;
}

