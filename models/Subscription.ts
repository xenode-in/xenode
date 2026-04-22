import mongoose, { Schema, Document, Model } from "mongoose";
import type { BillingCycle } from "@/types/pricing";

export interface ISubscription extends Document {
  userId: string;
  planSlug: string;
  status:
    | "created"
    | "authenticated"
    | "active"
    | "pending"
    | "halted"
    | "past_due"
    | "paused"
    | "cancelled"
    | "completed"
    | "expired";
  subscription_id?: string;
  mandate_status?: string;
  billingCycle: BillingCycle;
  startDate: Date;
  endDate: Date;
  current_period_start?: Date;
  current_period_end?: Date;
  paid_count?: number;
  total_count?: number;
  cancel_at_cycle_end?: boolean;
  offerApplied?: boolean;
  /** Whether a base-plan upgrade has been scheduled via Razorpay Update API */
  basePlanScheduled?: boolean;
  chargeCount?: number;
  cancelAtPeriodEnd?: boolean;
  autoRenew: boolean;
  gateway?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: String, required: true, index: true },
    planSlug: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "created",
        "authenticated",
        "active",
        "pending",
        "halted",
        "past_due",
        "paused",
        "cancelled",
        "completed",
        "expired",
      ],
      default: "created",
      index: true,
    },
    subscription_id: { type: String, unique: true, sparse: true, index: true },
    mandate_status: { type: String },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "quarterly", "lifetime"],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true },
    current_period_start: { type: Date },
    current_period_end: { type: Date },
    paid_count: { type: Number, default: 0 },
    total_count: { type: Number },
    cancel_at_cycle_end: { type: Boolean, default: false },
    offerApplied: { type: Boolean, default: false, index: true },
    basePlanScheduled: { type: Boolean, default: false },
    chargeCount: { type: Number, default: 0 },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    autoRenew: { type: Boolean, default: false },
    gateway: { type: String, default: "razorpay" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const Subscription: Model<ISubscription> =
  mongoose.models.Subscription ||
  mongoose.model<ISubscription>("Subscription", SubscriptionSchema);

export default Subscription;
