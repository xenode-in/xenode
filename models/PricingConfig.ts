import mongoose, { Schema, Document } from "mongoose";

export interface IPlan {
  name: string;
  slug: string;
  storage: string;
  storageLimitBytes: number;
  priceINR: number;
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
}

export interface IPricingConfig extends Document {
  plans: IPlan[];
  campaign: ICampaign | null;
  updatedBy: string;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  storage: { type: String, required: true },
  storageLimitBytes: { type: Number, required: true },
  priceINR: { type: Number, required: true },
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
});

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
