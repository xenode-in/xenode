import type { BillingCycle } from "@/types/pricing";

/**
 * Organization plan catalog.
 *
 * Kept in a dedicated module (not the shared `PricingConfig`) so the personal
 * `/pricing` and `/plans` surfaces stay untouched — no filtering needed and no
 * risk of org plans leaking onto the consumer pricing pages. Org billing
 * resolves plans exclusively through the helpers here.
 *
 * `razorpayPlanId`s are environment-overridable; the defaults are placeholders
 * matching the personal-plan convention. An admin must configure real Razorpay
 * plan ids before org checkout works in production (same as personal plans).
 */
export interface OrgPlanPricing {
  cycle: Extract<BillingCycle, "monthly" | "yearly">;
  priceINR: number;
  razorpayPlanId: string;
}

export interface OrgPlan {
  slug: string;
  name: string;
  storage: string;
  storageLimitBytes: number | null; // null = unlimited (enterprise)
  /** Max non-guest members. null = unlimited (enterprise). */
  maxSeats: number | null;
  /** Empty for free / custom (enterprise) plans that don't self-checkout. */
  pricing: OrgPlanPricing[];
  features: string[];
}

const GB = 1024 * 1024 * 1024;
const TB = 1024 * GB;

export const ORG_PLANS: OrgPlan[] = [
  {
    slug: "org-free",
    name: "Free",
    storage: "5 GB",
    storageLimitBytes: 5 * GB,
    maxSeats: 3,
    pricing: [],
    features: ["3 members", "5 GB shared storage", "One verified domain"],
  },
  {
    slug: "org-starter",
    name: "Starter",
    storage: "250 GB",
    storageLimitBytes: 250 * GB,
    maxSeats: 10,
    pricing: [
      {
        cycle: "monthly",
        priceINR: 499,
        razorpayPlanId:
          process.env.RZP_ORG_STARTER_MONTHLY || "plan_OrgStarterMonthly_1",
      },
      {
        cycle: "yearly",
        priceINR: 4990,
        razorpayPlanId:
          process.env.RZP_ORG_STARTER_YEARLY || "plan_OrgStarterYearly_1",
      },
    ],
    features: ["10 members", "250 GB shared storage", "Team spaces"],
  },
  {
    slug: "org-team",
    name: "Team",
    storage: "1 TB",
    storageLimitBytes: TB,
    maxSeats: 25,
    pricing: [
      {
        cycle: "monthly",
        priceINR: 999,
        razorpayPlanId:
          process.env.RZP_ORG_TEAM_MONTHLY || "plan_OrgTeamMonthly_1",
      },
      {
        cycle: "yearly",
        priceINR: 9990,
        razorpayPlanId:
          process.env.RZP_ORG_TEAM_YEARLY || "plan_OrgTeamYearly_1",
      },
    ],
    features: ["25 members", "1 TB shared storage", "Guests", "Priority support"],
  },
  {
    slug: "org-business",
    name: "Business",
    storage: "2 TB",
    storageLimitBytes: 2 * TB,
    maxSeats: 100,
    pricing: [
      {
        cycle: "monthly",
        priceINR: 1999,
        razorpayPlanId:
          process.env.RZP_ORG_BUSINESS_MONTHLY || "plan_OrgBusinessMonthly_1",
      },
      {
        cycle: "yearly",
        priceINR: 19990,
        razorpayPlanId:
          process.env.RZP_ORG_BUSINESS_YEARLY || "plan_OrgBusinessYearly_1",
      },
    ],
    features: ["100 members", "2 TB shared storage", "Audit logs", "API access"],
  },
  {
    slug: "org-enterprise",
    name: "Enterprise",
    storage: "Custom",
    storageLimitBytes: null,
    maxSeats: null,
    pricing: [],
    features: ["Unlimited members", "Custom storage", "SSO", "SLA"],
  },
];

/** The default plan a newly created organization sits on. */
export const ORG_FREE_PLAN_SLUG = "org-free";

export function getOrgPlanBySlug(slug: string): OrgPlan | undefined {
  return ORG_PLANS.find((plan) => plan.slug === slug);
}

/**
 * Reverse lookup for the webhook: find the org plan + cycle owning a Razorpay
 * plan id. Mirrors `getPlanByRazorpayPlanIdFromDB` for personal plans.
 */
export function getOrgPlanByRazorpayPlanId(
  razorpayPlanId: string,
): { plan: OrgPlan; cycle: OrgPlanPricing["cycle"] } | undefined {
  if (!razorpayPlanId) return undefined;
  for (const plan of ORG_PLANS) {
    const match = plan.pricing.find((p) => p.razorpayPlanId === razorpayPlanId);
    if (match) return { plan, cycle: match.cycle };
  }
  return undefined;
}

/**
 * Resolve the checkout context for an org plan + cycle. Throws a plain Error
 * (callers convert to BillingError) when the plan/cycle isn't self-checkoutable.
 */
export function getOrgRecurringPlanContext(
  planSlug: string,
  billingCycle: BillingCycle,
): { plan: OrgPlan; pricing: OrgPlanPricing; baseAmountPaise: number } {
  const plan = getOrgPlanBySlug(planSlug);
  if (!plan) throw new Error("Invalid organization plan");
  if (billingCycle !== "monthly" && billingCycle !== "yearly") {
    throw new Error("Organization plans support monthly or yearly billing only");
  }
  const pricing = plan.pricing.find((p) => p.cycle === billingCycle);
  if (!pricing || !pricing.razorpayPlanId) {
    throw new Error(
      "This organization plan is not configured for the selected billing cycle",
    );
  }
  return { plan, pricing, baseAmountPaise: Math.round(pricing.priceINR * 100) };
}
