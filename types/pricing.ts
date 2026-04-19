/**
 * types/pricing.ts — Shared TypeScript types for billing & pricing.
 *
 * Import from here instead of re-declaring in individual files.
 */

export type BillingCycle = "monthly" | "yearly" | "quarterly" | "lifetime";

export interface IPlanPricing {
  cycle: BillingCycle;
  /** Price in Indian Rupees */
  priceINR: number;
  /**
   * Optional display-only discount label.
   * e.g. 17 means "Save 17%" badge shown on yearly plan.
  /**
   * Razorpay Plan ID for subscriptions (recurring).
   * e.g. plan_N6O...
   */
  razorpayPlanId?: string;
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
