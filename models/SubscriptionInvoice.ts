import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISubscriptionInvoice extends Document {
  subscription_id: string; // Razorpay subscription ID
  payment_id: string;      // Razorpay payment ID
  amount: number;
  status: string;
  billing_date: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionInvoiceSchema = new Schema<ISubscriptionInvoice>(
  {
    subscription_id: { type: String, required: true, index: true },
    payment_id: { type: String, required: true, unique: true, index: true },
    amount: { type: Number, required: true },
    status: { type: String, required: true },
    billing_date: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const SubscriptionInvoice: Model<ISubscriptionInvoice> =
  mongoose.models.SubscriptionInvoice ||
  mongoose.model<ISubscriptionInvoice>("SubscriptionInvoice", SubscriptionInvoiceSchema);

export default SubscriptionInvoice;
