import mongoose, { Schema, Document, Model } from "mongoose";
import type { BillingCycle } from "@/types/pricing";

/**
 * Campaign — first-class promotion record. Replaces the single embedded
 * `PricingConfig.campaign` so we can:
 *   - run multiple overlapping campaigns (resolved by priority)
 *   - schedule future campaigns (startsAt in the future)
 *   - target by plan, cycle, audience cohort
 *   - link a Razorpay offer for subscription discounts
 *   - cap total redemptions
 *
 * Lower `priority` wins (so an emergency 50%-off priority=1 trumps a
 * marketing 10%-off priority=100).
 */

export type CampaignDuration = "forever" | "limited";
export type CampaignAudience = "all" | "free_only" | `plan:${string}`;

export interface ICampaign extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  /** Either percent OR flat must be set, not both. Validated in service layer. */
  discountPercent: number | null;
  flatDiscountPaise: number | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  badge: string;
  duration: CampaignDuration;
  /** When duration === "limited", how many cycles the discount applies. */
  cycles: number | null;
  targetAudience: CampaignAudience;
  /** Restrict to specific plan slugs. Empty array = all plans. */
  applicablePlans: string[];
  /** Restrict to specific billing cycles. Empty array = all cycles. */
  applicableCycles: BillingCycle[];
  /** Optional Razorpay offer id for subscription native discounts. */
  razorpayOfferId: string | null;
  priority: number;
  /** Caps. null = uncapped. */
  maxRedemptions: number | null;
  redeemedCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    discountPercent: { type: Number, default: null, min: 1, max: 99 },
    flatDiscountPaise: { type: Number, default: null, min: 1 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, index: true },
    badge: { type: String, default: "" },
    duration: {
      type: String,
      enum: ["forever", "limited"],
      default: "limited",
    },
    cycles: { type: Number, default: null },
    targetAudience: { type: String, default: "all" },
    applicablePlans: { type: [String], default: [] },
    applicableCycles: {
      type: [String],
      default: [],
    },
    razorpayOfferId: { type: String, default: null },
    priority: { type: Number, default: 100, index: true },
    maxRedemptions: { type: Number, default: null },
    redeemedCount: { type: Number, default: 0 },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

CampaignSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

const Campaign: Model<ICampaign> =
  mongoose.models.Campaign ||
  mongoose.model<ICampaign>("Campaign", CampaignSchema);

export default Campaign;
