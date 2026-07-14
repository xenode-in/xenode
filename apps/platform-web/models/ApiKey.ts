import mongoose, { Schema, Document, Model } from "mongoose";
import crypto from "crypto";

export interface IApiKey extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "Key name is required"],
      trim: true,
    },
    keyPrefix: {
      type: String,
      required: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes
 *
 * - keyHash:         unique – authentication token lookups (findOne({ keyHash }))
 * - userId:          single – ownership filter base (kept for lean queries)
 * - {userId, createdAt}: compound – covers list queries: find({userId}).sort({createdAt:-1})
 *                        and countDocuments({userId}) with no in-memory sort
 */
ApiKeySchema.index({ userId: 1, createdAt: -1 });

/**
 * Generate a new API key and return both the full key (shown once) and the hash
 */
export function generateApiKey(): {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const rawKey = crypto.randomBytes(32).toString("hex");
  const fullKey = `xn_${rawKey}`;
  const keyPrefix = `xn_${rawKey.slice(0, 8)}...`;
  const keyHash = crypto.createHash("sha256").update(fullKey).digest("hex");
  return { fullKey, keyPrefix, keyHash };
}

const ApiKey: Model<IApiKey> =
  mongoose.models.ApiKey || mongoose.model<IApiKey>("ApiKey", ApiKeySchema);

export default ApiKey;
