/**
 * pricingService.ts — Single source of truth for all pricing calculations.
 *
 * RULES:
 *  - All price math lives HERE. No other file should compute prices.
 *  - Pure functions only — no DB calls, no side effects.
 *  - Import BillingCycle and IPlanPricing from @/types/pricing.
 *
 * Used by:
 *  - lib/config/getPricingConfig.ts
 *  - app/api/payment/payu/route.ts
 *  - app/api/admin/pricing/route.ts
 *  - Frontend components (via shared util import)
 */

import type { BillingCycle, IPlanPricing, PlanCardProps } from "@/types/pricing";

// ─── Price Resolution ────────────────────────────────────────────────────────

/**
 * Returns the raw base price for a plan + billing cycle.
 * Throws if the cycle is not configured for that plan.
 */
export function getBasePriceForCycle(
  pricing: IPlanPricing[],
  cycle: BillingCycle
): number {
  const entry = pricing.find((p) => p.cycle === cycle);
  if (!entry) {
    throw new Error(`Billing cycle "${cycle}" is not configured for this plan.`);
  }
  return entry.priceINR;
}

/**
 * Returns the effective (after campaign discount) price for a plan + cycle.
 * This is the authoritative price used for payment hash generation.
 *
 * @param pricing        - The plan's pricing[] array
 * @param cycle          - Selected billing cycle
 * @param campaignDiscount - Active campaign discount percent (0–100), or undefined
 */
export function getEffectivePriceForCycle(
  pricing: IPlanPricing[],
  cycle: BillingCycle,
  campaignDiscount?: number
): number {
  const base = getBasePriceForCycle(pricing, cycle);
  if (!campaignDiscount || campaignDiscount <= 0) return base;
  return Math.round(base * (1 - campaignDiscount / 100));
}

// ─── Savings & Display Helpers ───────────────────────────────────────────────

/**
 * Calculates the saving percentage of yearly vs paying monthly × 12.
 * Returns null if either cycle is missing.
 *
 * Example: monthly=699, yearly=6990 → saves 838 → ~17%
 */
export function getYearlySavingsPercent(pricing: IPlanPricing[]): number | null {
  const monthly = pricing.find((p) => p.cycle === "monthly");
  const yearly = pricing.find((p) => p.cycle === "yearly");
  if (!monthly || !yearly) return null;

  const annualIfMonthly = monthly.priceINR * 12;
  if (annualIfMonthly === 0) return null;

  return Math.round(((annualIfMonthly - yearly.priceINR) / annualIfMonthly) * 100);
}

/**
 * Returns the effective monthly cost when billed yearly.
 * Useful for displaying "₹582/mo" under the yearly price.
 */
export function getMonthlyEquivalentForYearly(pricing: IPlanPricing[]): number | null {
  const yearly = pricing.find((p) => p.cycle === "yearly");
  if (!yearly) return null;
  return Math.round(yearly.priceINR / 12);
}

// ─── Subscription Date Helpers ───────────────────────────────────────────────

/**
 * Calculates subscription end date based on start date and billing cycle.
 */
export function getSubscriptionEndDate(startDate: Date, cycle: BillingCycle): Date {
  const end = new Date(startDate);
  switch (cycle) {
    case "monthly":
      end.setMonth(end.getMonth() + 1);
      break;
    case "yearly":
      end.setFullYear(end.getFullYear() + 1);
      break;
    case "quarterly":
      end.setMonth(end.getMonth() + 3);
      break;
    case "lifetime":
      // 99 years as a practical "forever" date
      end.setFullYear(end.getFullYear() + 99);
      break;
    default: {
      const _exhaustive: never = cycle;
      throw new Error(`Unhandled billing cycle: ${_exhaustive}`);
    }
  }
  return end;
}

/**
 * Checks whether a subscription is currently active.
 */
export function isSubscriptionActive(
  startDate: Date,
  endDate: Date,
  now: Date = new Date()
): boolean {
  return now >= startDate && now <= endDate;
}

// ─── Campaign Resolution ─────────────────────────────────────────────────────

export interface ActiveCampaign {
  name: string;
  discountPercent: number;
  badge: string;
  discountDuration: "forever" | "limited";
  discountCycles: number | null;
}

/**
 * Returns the active campaign if within date range, or null.
 * Keeps campaign resolution logic out of route handlers.
 */
export function resolveActiveCampaign(
  campaign: {
    isActive: boolean;
    startDate: Date;
    endDate: Date;
    discountPercent: number;
    name: string;
    badge: string;
    discountDuration?: "forever" | "limited";
    discountCycles?: number | null;
  } | null,
  now: Date = new Date()
): ActiveCampaign | null {
  if (!campaign || !campaign.isActive) return null;
  if (now < new Date(campaign.startDate) || now > new Date(campaign.endDate)) return null;
  return {
    name: campaign.name,
    discountPercent: campaign.discountPercent,
    badge: campaign.badge,
    discountDuration: campaign.discountDuration || "forever",
    discountCycles: campaign.discountCycles ?? null,
  };
}
