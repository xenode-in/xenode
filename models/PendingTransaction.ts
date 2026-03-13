import mongoose, { Schema, Document, Model } from "mongoose";

export interface SIDetails {
  billingAmount: string;
  billingCycle: "MONTHLY" | "YEARLY" | "WEEKLY" | "ADHOC";
  billingInterval: number;
  paymentStartDate: string; // YYYY-MM-DD
  paymentEndDate: string; // YYYY-MM-DD
  remarks: string;
}

export interface IPendingTransaction extends Document {
  txnid: string;
  userId: string;
  planName: string;
  storageLimitBytes: number;
  planPriceINR: number;
  expiresAt: Date;
  createdAt: Date;
  /** 'autopay' = UPI SI mandate, 'direct' = one-time payment */
  paymentMethod: "autopay" | "direct";
  /** Only present when paymentMethod === 'autopay' */
  siDetails?: SIDetails;
  /** Billing address — stored here so success route can persist to user profile */
  billingAddress?: {
    name: string;
    line1: string;
    city: string;
    state: string;
    pin: string;
    country: string;
  };
}

const PendingTransactionSchema = new Schema<IPendingTransaction>(
  {
    txnid: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    planName: { type: String, required: true },
    storageLimitBytes: { type: Number, required: true },
    planPriceINR: { type: Number, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    paymentMethod: {
      type: String,
      enum: ["autopay", "direct"],
      default: "direct",
    },
    siDetails: {
      type: {
        billingAmount: String,
        billingCycle: String,
        billingInterval: Number,
        paymentStartDate: String,
        paymentEndDate: String,
        remarks: String,
      },
      default: null,
    },
    billingAddress: {
      type: {
        name: String,
        line1: String,
        city: String,
        state: String,
        pin: String,
        country: String,
      },
      default: null,
    },
  },
  { timestamps: true },
);

const PendingTransaction: Model<IPendingTransaction> =
  mongoose.models.PendingTransaction ||
  mongoose.model<IPendingTransaction>(
    "PendingTransaction",
    PendingTransactionSchema,
  );

export default PendingTransaction;
