/**
 * plans.ts — Static fallback / reference for plan definitions.
 *
 * ⚠️  DEPRECATED for runtime use.
 * The live source of truth is now lib/config/getPricingConfig.ts (DB-backed).
 *
 * This file is kept ONLY as:
 *  1. A reference for the canonical plan shape.
 *  2. A fallback for unit tests that don't need a DB.
 *
 * DO NOT import PLANS or PLAN_CONFIG in API routes.
 * Use getPlanConfigFromDB() and getPlanBySlugFromDB() instead.
 */

import type { BillingCycle, IPlanPricing } from "@/types/pricing";

export interface PlanConfig {
  name: string;
  slug: string;
  storage: string;
  storageLimitBytes: number;
  pricing: IPlanPricing[];
  features: string[];
  isPopular?: boolean;
}

export const PLANS: PlanConfig[] = [
  {
    name: "100GB Model",
    slug: "basic",
    storage: "100 GB",
    storageLimitBytes: 100 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 149 },
      { cycle: "yearly", priceINR: 1490, discountPercent: 17 },
    ],
    features: [
      "100 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "500GB Model",
    slug: "pro",
    storage: "500 GB",
    storageLimitBytes: 500 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 399 },
      { cycle: "yearly", priceINR: 3990, discountPercent: 17 },
    ],
    features: [
      "500 GB E2EE Storage",
      "End-to-End Encryption",
      "Global Access",
      "No Hidden Fees",
    ],
  },
  {
    name: "1TB Model",
    slug: "plus",
    storage: "1 TB",
    storageLimitBytes: 1024 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 699 },
      { cycle: "yearly", priceINR: 6990, discountPercent: 17 },
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
    name: "2TB Model",
    slug: "max",
    storage: "2 TB",
    storageLimitBytes: 2 * 1024 * 1024 * 1024 * 1024,
    pricing: [
      { cycle: "monthly", priceINR: 999 },
      { cycle: "yearly", priceINR: 9990, discountPercent: 17 },
    ],
    features: [
      "2 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
];

/** Look up plan by slug */
export function getPlanBySlug(slug: string): PlanConfig | undefined {
  return PLANS.find((p) => p.slug === slug);
}

/** Look up plan by internal name */
export function getPlanByName(name: string): PlanConfig | undefined {
  return PLANS.find((p) => p.name === name);
}

/**
 * @deprecated Use getPlanConfigFromDB(cycle) from lib/config/getPricingConfig.ts
 * Kept for unit test compatibility only.
 */
export const PLAN_CONFIG: Record<string, { storageLimitBytes: number; priceINR: number }> =
  Object.fromEntries(
    PLANS.map((p) => [
      p.name,
      {
        storageLimitBytes: p.storageLimitBytes,
        // Falls back to monthly price for the legacy scalar shape
        priceINR: p.pricing.find((x) => x.cycle === "monthly")?.priceINR ?? 0,
      },
    ])
  );
