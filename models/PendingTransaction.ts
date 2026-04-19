/**
 * PendingTransaction.ts
 *
 * SCHEMA CHANGE (multi-cycle refactor):
 *   - Added `billingCycle` — used by success webhook to compute planExpiresAt
 *     via getSubscriptionEndDate() instead of the old hardcoded +30 days.
 *   - Default: "monthly" for backward compatibility with existing pending rows.
 */
import mongoose, { Schema, Document, Model } from "mongoose";
import type { BillingCycle } from "@/types/pricing";

export interface IPendingTransaction extends Document {
  txnid: string;
  userId: string;
  planName: string;
  planSlug: string;
  storageLimitBytes: number;
  /** Base plan price for the selected cycle (before coupon/proration deductions) */
  planPriceINR: number;
  /** Original un-discounted base price for the cycle */
  basePlanPriceINR: number;
  /** Billing cycle the user selected (monthly, yearly, etc.) */
  billingCycle: BillingCycle;
  /** Campaign duration type applied */
  campaignType?: "forever" | "limited" | null;
  /** Number of discounted billing cycles remaining (if limited) */
  campaignCyclesLeft?: number | null;
  couponId?: string;
  couponCode?: string;
  couponDiscount?: number;
  expiresAt: Date;
  paymentMethod: "autopay" | "direct";
  gateway: string;
  billingAddress?: object | null;
  expectedAmount?: number;
}

const PendingTransactionSchema = new Schema<IPendingTransaction>(
  {
    txnid: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    planName: { type: String, required: true },
    planSlug: { type: String, default: "" },
    storageLimitBytes: { type: Number, required: true },
    planPriceINR: { type: Number, required: true },
    basePlanPriceINR: { type: Number, default: 0 },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "quarterly", "lifetime"],
      default: "monthly",
    },
    campaignType: { type: String, enum: ["forever", "limited", null], default: null },
    campaignCyclesLeft: { type: Number, default: null },
    couponId: { type: String, default: null },
    couponCode: { type: String, default: null },
    couponDiscount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    paymentMethod: {
      type: String,
      enum: ["autopay", "direct"],
      required: true,
    },
    gateway: { type: String, default: "razorpay" },
    billingAddress: { type: Schema.Types.Mixed, default: null },
    expectedAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const PendingTransaction: Model<IPendingTransaction> =
  mongoose.models.PendingTransaction ||
  mongoose.model<IPendingTransaction>(
    "PendingTransaction",
    PendingTransactionSchema
  );

export default PendingTransaction;
