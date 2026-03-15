import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Plan limit constants ────────────────────────────────────────────────────
// Single source of truth — import these wherever you need plan limits.
// Never hardcode GB values in route files.
//
// PRO_TIER_LIMIT_BYTES = null means unlimited (no quota enforcement).
// In presign-upload/route.ts, treat null as "skip the quota check entirely".
export const FREE_TIER_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const PRO_TIER_LIMIT_BYTES: null = null;               // Unlimited

export interface IUsage extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  totalStorageBytes: number;
  totalEgressBytes: number;
  totalObjects: number;
  totalBuckets: number;
  storageLimitBytes: number | null; // null = unlimited (pro/enterprise)
  egressLimitBytes: number;
  plan: "free" | "basic" | "pro" | "plus" | "max" | "enterprise";
  planActivatedAt: Date | null;
  planExpiresAt: Date | null;
  planPriceINR: number;
  uploadCount: number;
  downloadCount: number;
  lastActiveAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  scheduledDowngradePlan: string | null;
  scheduledDowngradeLimitBytes: number | null;
  scheduledDowngradeAt: Date | null;
  // UPI Autopay mandate fields
  autopayMandateId: string | null;
  autopayActive: boolean;
  lastRenewalTxnid: string | null;
}

const UsageSchema = new Schema<IUsage>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    totalStorageBytes: { type: Number, default: 0, min: 0 },
    totalEgressBytes:  { type: Number, default: 0, min: 0 },
    totalObjects:      { type: Number, default: 0, min: 0 },
    totalBuckets:      { type: Number, default: 0, min: 0 },
    // null = unlimited (pro). Default is FREE_TIER_LIMIT_BYTES (5 GB) for new users.
    storageLimitBytes: { type: Number, default: FREE_TIER_LIMIT_BYTES },
    egressLimitBytes:  { type: Number, default: 536870912000 },
    plan: {
      type: String,
      enum: ["free", "basic", "pro", "plus", "max", "enterprise"],
      default: "free",
      index: true,
    },
    planActivatedAt:  { type: Date, default: null },
    planExpiresAt:    { type: Date, default: null },
    planPriceINR:     { type: Number, default: 0 },
    uploadCount:      { type: Number, default: 0, min: 0 },
    downloadCount:    { type: Number, default: 0, min: 0 },
    lastActiveAt:     { type: Date, default: null, index: true },
    scheduledDowngradePlan:        { type: String,  default: null },
    scheduledDowngradeLimitBytes:  { type: Number,  default: null },
    scheduledDowngradeAt:          { type: Date,    default: null },
    // UPI Autopay
    autopayMandateId:   { type: String,  default: null },
    autopayActive:      { type: Boolean, default: false },
    lastRenewalTxnid:   { type: String,  default: null },
  },
  { timestamps: true },
);

const Usage: Model<IUsage> =
  mongoose.models.Usage || mongoose.model<IUsage>("Usage", UsageSchema);

export default Usage;
