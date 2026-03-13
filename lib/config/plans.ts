/**
 * plans.ts — Single source of truth for all Xenode plan definitions.
 *
 * Used by:
 *  - app/api/payment/payu/route.ts  (server-authoritative pricing)
 *  - app/components/checkout/*      (UI display)
 *  - app/components/PricingComparison.tsx
 *
 * NEVER derive plan prices or limits from client input.
 */

export interface PlanConfig {
  /** Internal name sent to PayU as productinfo */
  name: string;
  /** URL-safe slug used in /checkout?plan= */
  slug: string;
  /** Human-readable storage label */
  storage: string;
  storageLimitBytes: number;
  /** Monthly price in INR */
  priceINR: number;
  /** Displayed features on pricing/checkout UI */
  features: string[];
  isPopular?: boolean;
}

export const PLANS: PlanConfig[] = [
  {
    name: "100GB Model",
    slug: "basic",
    storage: "100 GB",
    storageLimitBytes: 100 * 1024 * 1024 * 1024,
    priceINR: 149,
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
    priceINR: 399,
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
    priceINR: 699,
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
    priceINR: 999,
    features: [
      "2 TB E2EE Storage",
      "End-to-End Encryption",
      "Priority Support",
      "Global Access",
    ],
  },
];

/** Look up plan by slug (URL param) */
export function getPlanBySlug(slug: string): PlanConfig | undefined {
  return PLANS.find((p) => p.slug === slug);
}

/** Look up plan by internal name (PayU productinfo) */
export function getPlanByName(name: string): PlanConfig | undefined {
  return PLANS.find((p) => p.name === name);
}

/** Server-authoritative map for API routes */
export const PLAN_CONFIG: Record<string, { storageLimitBytes: number; priceINR: number }> =
  Object.fromEntries(PLANS.map((p) => [p.name, { storageLimitBytes: p.storageLimitBytes, priceINR: p.priceINR }]));
