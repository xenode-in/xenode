import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUsage extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  totalStorageBytes: number;
  totalEgressBytes: number;
  totalObjects: number;
  totalBuckets: number;
  storageLimitBytes: number;
  egressLimitBytes: number;
  // Analytics fields
  plan: "free" | "pro" | "enterprise";
  planActivatedAt: Date | null;
  planExpiresAt: Date | null;
  uploadCount: number;
  downloadCount: number;
  lastActiveAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

const UsageSchema = new Schema<IUsage>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      unique: true,
      index: true,
    },
    totalStorageBytes: { type: Number, default: 0, min: 0 },
    totalEgressBytes: { type: Number, default: 0, min: 0 },
    totalObjects: { type: Number, default: 0, min: 0 },
    totalBuckets: { type: Number, default: 0, min: 0 },
    // 1 TB default storage limit
    storageLimitBytes: { type: Number, default: 1099511627776 },
    // 500 GB default egress limit
    egressLimitBytes: { type: Number, default: 536870912000 },
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
      index: true,
    },
    planActivatedAt: { type: Date, default: null },
    planExpiresAt: { type: Date, default: null },
    uploadCount: { type: Number, default: 0, min: 0 },
    downloadCount: { type: Number, default: 0, min: 0 },
    lastActiveAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

const Usage: Model<IUsage> =
  mongoose.models.Usage || mongoose.model<IUsage>("Usage", UsageSchema);

export default Usage;
