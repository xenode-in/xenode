import mongoose, { Schema, Document, Model } from "mongoose";
import type { BillingCycle } from "@/types/pricing";

export interface ISubscription extends Document {
  userId: string;
  planSlug: string;
  status: "active" | "canceled" | "past_due" | "expired";
  billingCycle: BillingCycle;
  startDate: Date;
  endDate: Date;
  autoRenew: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: String, required: true, index: true },
    planSlug: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "canceled", "past_due", "expired"],
      default: "active",
      index: true,
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "quarterly", "lifetime"],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true },
    autoRenew: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const Subscription: Model<ISubscription> =
  mongoose.models.Subscription ||
  mongoose.model<ISubscription>("Subscription", SubscriptionSchema);

export default Subscription;
