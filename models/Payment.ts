/**
 * Payment.ts — Mongoose model for payment records.
 *
 * SCHEMA CHANGE (multi-cycle refactor):
 *   - Added `billingCycle` — defaults to "monthly" for backward compat.
 *   - Added `subscriptionStartDate` and `subscriptionEndDate`.
 *
 * End date is calculated via getSubscriptionEndDate() in pricingService.ts
 * and stored here so queries like "find active subscribers" are O(1) index scans.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import type { BillingCycle } from "@/types/pricing";

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  amount: number;
  currency: string;
  status: "success" | "pending" | "failed" | "refunded" | "refund_pending";
  txnid: string;
  planName: string;
  /** Billing cycle selected at checkout — defaults to monthly for old records */
  billingCycle: BillingCycle;
  /** When this subscription period starts (payment success date) */
  subscriptionStartDate: Date;
  /** Pre-computed expiry date based on billingCycle */
  subscriptionEndDate: Date;
  payuResponse?: any;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["success", "pending", "failed", "refunded", "refund_pending"],
      default: "pending",
      index: true,
    },
    txnid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    planName: {
      type: String,
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "quarterly", "lifetime"] satisfies BillingCycle[],
      default: "monthly", // backward compat: old records treated as monthly
    },
    subscriptionStartDate: {
      type: Date,
      default: null,
    },
    subscriptionEndDate: {
      type: Date,
      default: null,
      index: true, // indexed for fast "find active subscriptions" queries
    },
    payuResponse: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

const Payment: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>("Payment", PaymentSchema);

export default Payment;
