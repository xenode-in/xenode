import mongoose, { Schema, Document, Model } from "mongoose";
import crypto from "crypto";

export interface IShareLink extends Document {
  _id: mongoose.Types.ObjectId;
  token: string;
  objectId: mongoose.Types.ObjectId;
  bucketId: mongoose.Types.ObjectId;
  createdBy: string;
  expiresAt?: Date;
  maxDownloads?: number;
  downloadCount: number;
  isRevoked: boolean;
  isPasswordProtected: boolean;
  passwordHash?: string;
  passwordFailureCount: number;
  passwordLockedUntil?: Date | null;
  /** For E2EE files: DEK re-wrapped with per-share AES-GCM key */
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  shareEncryptedThumbnail?: string;
  accessType: "view" | "download";
  sharedWith: string[]; // Array of emails or user IDs the file is explicitly shared with
  createdAt: Date;
  updatedAt: Date;
}

const ShareLinkSchema = new Schema<IShareLink>(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(32).toString("base64url"),
      index: true,
    },
    objectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: true,
      index: true,
    },
    bucketId: {
      type: Schema.Types.ObjectId,
      ref: "Bucket",
      required: true,
    },
    createdBy: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: false },
    maxDownloads: { type: Number, required: false, min: 1 },
    downloadCount: { type: Number, default: 0 },
    isRevoked: { type: Boolean, default: false },
    isPasswordProtected: { type: Boolean, default: false },
    passwordHash: { type: String, required: false },
    passwordFailureCount: { type: Number, default: 0 },
    passwordLockedUntil: { type: Date, default: null },
    shareEncryptedDEK: { type: String, required: false },
    shareKeyIv: { type: String, required: false },
    shareEncryptedName: { type: String, required: false },
    shareEncryptedContentType: { type: String, required: false },
    shareEncryptedThumbnail: { type: String, required: false },
    accessType: {
      type: String,
      enum: ["view", "download"],
      default: "download",
    },
    sharedWith: {
      type: [String],
      default: [],
      index: true,
    },
  },
  { timestamps: true },
);

// MongoDB TTL — auto-deletes expired docs
ShareLinkSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, sparse: true },
);
ShareLinkSchema.index({ createdBy: 1, createdAt: -1 });
ShareLinkSchema.index({ objectId: 1, isRevoked: 1 });

const ShareLink: Model<IShareLink> =
  mongoose.models.ShareLink ||
  mongoose.model<IShareLink>("ShareLink", ShareLinkSchema);

export default ShareLink;
