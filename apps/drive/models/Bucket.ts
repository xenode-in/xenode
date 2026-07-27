import mongoose, { Schema, Document, Model } from "mongoose";
import type { StorageRegion } from "@xenode/config/storage";

export interface IBucket extends Document {
  _id: mongoose.Types.ObjectId;
  systemKey: "drive";
  storageRegion: StorageRegion;
  name: string;
  b2BucketId: string;
  /** S3 signing region (`auto` for Cloudflare R2). */
  region: string;
  objectCount: number;
  totalSizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

const BucketSchema = new Schema<IBucket>(
  {
    systemKey: {
      type: String,
      enum: ["drive"],
      required: true,
      default: "drive",
    },
    storageRegion: {
      type: String,
      enum: ["asia", "us", "eu"],
      required: true,
      default: "asia",
    },
    name: {
      type: String,
      required: [true, "Bucket name is required"],
      trim: true,
      lowercase: true,
      match: [
        /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
        "Bucket name must be 3-63 characters, lowercase alphanumeric and hyphens only",
      ],
    },
    b2BucketId: {
      type: String,
      required: true,
      unique: true,
    },
    region: {
      type: String,
      default: "us-west-004",
    },
    objectCount: {
      type: Number,
      default: 0,
    },
    totalSizeBytes: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

BucketSchema.index(
  { systemKey: 1, storageRegion: 1 },
  { unique: true, name: "systemKey_1_storageRegion_1" },
);

const Bucket: Model<IBucket> =
  mongoose.models.Bucket || mongoose.model<IBucket>("Bucket", BucketSchema);

export default Bucket;
