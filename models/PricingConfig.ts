/**
 * PricingConfig.ts — Mongoose model for dynamic pricing configuration.
 *
 * Single source of truth for plan prices and storage limits. Campaign / promo
 * data lives in the dedicated `Campaign` collection (`models/Campaign.ts`) —
 * not here.
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

export interface IPricingConfig extends Document {
  plans: IPlan[];
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
    razorpayPlanId: { type: String, default: "" },
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

// ─── Root schema ─────────────────────────────────────────────────────────────

const PricingConfigSchema = new Schema<IPricingConfig>(
  {
    plans: [PlanSchema],
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const PricingConfig =
  mongoose.models.PricingConfig ||
  mongoose.model<IPricingConfig>("PricingConfig", PricingConfigSchema);
