/**
 * types/pricing.ts — Shared TypeScript types for billing & pricing.
 *
 * Import from here instead of re-declaring in individual files.
 */

export type BillingCycle = "monthly" | "yearly" | "quarterly" | "lifetime";

/** Currencies billed per storage region (asia→INR, us→USD, eu→EUR). */
export type BillingCurrency = "INR" | "USD" | "EUR";

/** Region-specific price for a plan/cycle. Amount is in MAJOR units (₹/$/€). */
export interface RegionPrice {
  currency: BillingCurrency;
  amount: number;
  /** Razorpay Plan ID for this region's currency (must be created per currency). */
  razorpayPlanId?: string;
}

export interface IPlanPricing {
  cycle: BillingCycle;
  /** Canonical Asia/INR price in Indian Rupees (kept as the default region). */
  priceINR: number;
  /**
   * Optional display-only discount label.
   * e.g. 17 means "Save 17%" badge shown on yearly plan.
   */
  discountPercent?: number;
  /**
   * Razorpay Plan ID for the INR (Asia) subscription. e.g. plan_N6O...
   */
  razorpayPlanId?: string;
  /**
   * Per-region price overrides for non-default regions (us/eu). Asia derives
   * from `priceINR` + `razorpayPlanId`. Each region needs its own Razorpay plan
   * (created in the dashboard for that currency).
   */
  regions?: Partial<Record<"us" | "eu", RegionPrice>>;
}

export interface PlanCardProps {
  name: string;
  slug: string;
  storage: string;
  storageLimitBytes: number;
  pricing: IPlanPricing[];
  features: string[];
  isPopular?: boolean;
}

export interface CampaignBadge {
  name: string;
  discountPercent: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  badge: string;
}
