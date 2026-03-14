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
  /** Billing cycle the user selected (monthly, yearly, etc.) */
  billingCycle: BillingCycle;
  couponId?: string;
  couponCode?: string;
  couponDiscount?: number;
  expiresAt: Date;
  paymentMethod: "autopay" | "direct";
  billingAddress?: object | null;
}

const PendingTransactionSchema = new Schema<IPendingTransaction>(
  {
    txnid: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    planName: { type: String, required: true },
    planSlug: { type: String, default: "" },
    storageLimitBytes: { type: Number, required: true },
    planPriceINR: { type: Number, required: true },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "quarterly", "lifetime"],
      default: "monthly",
    },
    couponId: { type: String, default: null },
    couponCode: { type: String, default: null },
    couponDiscount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    paymentMethod: {
      type: String,
      enum: ["autopay", "direct"],
      required: true,
    },
    billingAddress: { type: Schema.Types.Mixed, default: null },
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
