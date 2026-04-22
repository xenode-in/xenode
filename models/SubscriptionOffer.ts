import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISubscriptionOffer extends Document {
  name: string;
  discountPercent: number;
  appliesForCycles: number;
  validFrom: Date;
  validUntil: Date | null;
  isActive: boolean;
  /** Razorpay Offer ID created on the Dashboard (e.g., offer_JHD834hjbxzhd38d) */
  razorpayOfferId: string;
  originalAmount: number;
  discountedAmount: number;
  createdBy: mongoose.Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionOfferSchema = new Schema<ISubscriptionOffer>(
  {
    name: { type: String, required: true, trim: true },
    discountPercent: { type: Number, required: true, min: 1, max: 99 },
    appliesForCycles: { type: Number, required: true, default: 1, min: 1 },
    validFrom: { type: Date, required: true, index: true },
    validUntil: { type: Date, default: null, index: true },
    isActive: { type: Boolean, default: false, index: true },
    razorpayOfferId: { type: String, required: true, unique: true },
    originalAmount: { type: Number, required: true, default: 99900 },
    discountedAmount: { type: Number, required: true, min: 1 },
    createdBy: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

SubscriptionOfferSchema.pre("validate", function calculateDiscount() {
  const doc = this as ISubscriptionOffer;
  const discountFactor = 1 - doc.discountPercent / 100;
  doc.discountedAmount = Math.max(1, Math.round(doc.originalAmount * discountFactor));
  if (!doc.appliesForCycles) {
    doc.appliesForCycles = 1;
  }
});

const SubscriptionOffer: Model<ISubscriptionOffer> =
  mongoose.models.SubscriptionOffer ||
  mongoose.model<ISubscriptionOffer>("SubscriptionOffer", SubscriptionOfferSchema);

export default SubscriptionOffer;
