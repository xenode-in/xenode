/**
 * PricingConfig.ts — Mongoose model for dynamic pricing configuration.
 *
 * SCHEMA CHANGE (multi-cycle refactor):
 *   - Replaced single `priceINR: number` with `pricing: IPlanPricing[]`
 *   - Each entry in pricing[] covers one BillingCycle (monthly, yearly, etc.)
 *   - Backward compat: old documents with priceINR are handled by the
 *     migration script at scripts/migratePricingToMultiCycle.ts
 *
 * See lib/pricing/pricingService.ts for all price calculation logic.
 */

import mongoose, { Schema, Document } from "mongoose";
import type { BillingCycle, IPlanPricing } from "@/types/pricing";

// Re-export so consumers can import from a single models path
export type { BillingCycle, IPlanPricing };

export interface IPlan {
  name: string;
  slug: string;
  storage: string;
  storageLimitBytes: number;
  /** Multi-cycle pricing — replaces the old scalar priceINR field */
  pricing: IPlanPricing[];
  features: string[];
  isPopular?: boolean;
}

export interface ICampaign {
  name: string;
  discountPercent: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  badge: string;
  /** "forever" (lifetime lock-in) or "limited" (X billing cycles) */
  discountDuration: "forever" | "limited";
  /** If limited, how many billing cycles the discount lasts */
  discountCycles: number | null;
  /** Restrict campaigns to certain users */
  targetAudience: "all" | "free_only";
}

export interface IPricingConfig extends Document {
  plans: IPlan[];
  campaign: ICampaign | null;
  updatedBy: string;
  updatedAt: Date;
}

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const PlanPricingSchema = new Schema<IPlanPricing>(
  {
    cycle: {
      type: String,
      enum: ["monthly", "yearly", "quarterly", "lifetime"] satisfies BillingCycle[],
      required: true,
    },
    priceINR: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, min: 0, max: 100, default: undefined },
  },
  { _id: false }
);

const PlanSchema = new Schema<IPlan>({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  storage: { type: String, required: true },
  storageLimitBytes: { type: Number, required: true },
  pricing: {
    type: [PlanPricingSchema],
    required: true,
    validate: {
      validator: (arr: IPlanPricing[]) =>
        arr.some((p) => p.cycle === "monthly"),
      message: "Each plan must have at least a monthly pricing entry.",
    },
  },
  features: [{ type: String }],
  isPopular: { type: Boolean, default: false },
});

const CampaignSchema = new Schema<ICampaign>({
  name: String,
  discountPercent: { type: Number, min: 1, max: 100 },
  startDate: Date,
  endDate: Date,
  isActive: { type: Boolean, default: true },
  badge: { type: String, default: "" },
  discountDuration: { type: String, enum: ["forever", "limited"], default: "forever" },
  discountCycles: { type: Number, default: null },
  targetAudience: { type: String, enum: ["all", "free_only"], default: "all" },
});

// ─── Root schema ─────────────────────────────────────────────────────────────

const PricingConfigSchema = new Schema<IPricingConfig>(
  {
    plans: [PlanSchema],
    campaign: { type: CampaignSchema, default: null },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const PricingConfig =
  mongoose.models.PricingConfig ||
  mongoose.model<IPricingConfig>("PricingConfig", PricingConfigSchema);
