import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICouponUsedBy {
  userId: string;
  usedAt: Date;
  txnid: string;
}

export interface ICoupon extends Document {
  /** Uppercase coupon code e.g. LAUNCH50 */
  code: string;
  /** global = anyone can use; user = only targetUserId */
  type: "global" | "user";
  /** Only set when type === 'user' */
  targetUserId?: string;
  /** percent = % off, flat = fixed ₹ off */
  discountType: "percent" | "flat";
  discountValue: number;
  /** 0 = unlimited */
  maxUses: number;
  /** How many times a single user can use this coupon */
  perUserLimit: number;
  /** Tracks redemptions */
  usedCount: number;
  usedBy: ICouponUsedBy[];
  /** Empty array = valid for all plans */
  applicablePlans: string[];
  validFrom: Date;
  validTo: Date;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    type: { type: String, enum: ["global", "user"], required: true },
    targetUserId: { type: String, default: null },
    discountType: { type: String, enum: ["percent", "flat"], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    maxUses: { type: Number, default: 0 }, // 0 = unlimited
    perUserLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    usedBy: [
      {
        userId: String,
        usedAt: Date,
        txnid: String,
      },
    ],
    applicablePlans: { type: [String], default: [] },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

const Coupon: Model<ICoupon> =
  mongoose.models.Coupon || mongoose.model<ICoupon>("Coupon", CouponSchema);

export default Coupon;
