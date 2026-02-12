import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBucket extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  name: string;
  b2BucketId: string;
  region: string;
  objectCount: number;
  totalSizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

const BucketSchema = new Schema<IBucket>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
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

// Compound index for user + bucket name uniqueness
BucketSchema.index({ userId: 1, name: 1 }, { unique: true });

const Bucket: Model<IBucket> =
  mongoose.models.Bucket || mongoose.model<IBucket>("Bucket", BucketSchema);

export default Bucket;
