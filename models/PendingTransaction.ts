import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPendingTransaction extends Document {
  txnid: string;
  userId: string;
  planName: string;
  storageLimitBytes: number;
  planPriceINR: number;
  expiresAt: Date;
  createdAt: Date;
}

const PendingTransactionSchema = new Schema<IPendingTransaction>(
  {
    txnid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    planName: {
      type: String,
      required: true,
    },
    storageLimitBytes: {
      type: Number,
      required: true,
    },
    planPriceINR: {
      type: Number,
      required: true,
    },
    // TTL index — auto-deletes pending transactions after 1 hour
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true },
);

const PendingTransaction: Model<IPendingTransaction> =
  mongoose.models.PendingTransaction ||
  mongoose.model<IPendingTransaction>("PendingTransaction", PendingTransactionSchema);

export default PendingTransaction;
