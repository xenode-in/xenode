import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPendingTransaction extends Document {
  txnid: string;
  userId: string;
  planName: string;
  storageLimitBytes: number;
  planPriceINR: number;
  /** Coupon applied to this transaction (if any) */
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
    storageLimitBytes: { type: Number, required: true },
    planPriceINR: { type: Number, required: true },
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
