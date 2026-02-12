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
    totalStorageBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEgressBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalObjects: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalBuckets: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 1 TB default storage limit
    storageLimitBytes: {
      type: Number,
      default: 1099511627776, // 1 TB
    },
    // 500 GB default egress limit
    egressLimitBytes: {
      type: Number,
      default: 536870912000, // 500 GB
    },
  },
  {
    timestamps: true,
  },
);

const Usage: Model<IUsage> =
  mongoose.models.Usage || mongoose.model<IUsage>("Usage", UsageSchema);

export default Usage;
