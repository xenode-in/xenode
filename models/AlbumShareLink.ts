import mongoose, { Schema, Document, Model } from "mongoose";
import crypto from "crypto";

/**
 * One public share of a whole photo album. A single random AES-GCM "share key"
 * (lives only in the link's URL fragment, never sent to the server) wraps every
 * photo's DEK and encrypts its name/contentType. Anonymous visitors with the
 * link can therefore view & download every photo without a Xenode account.
 *
 * This lives in the storage/keys domain — billing code must never read it.
 */
export interface IAlbumShareItem {
  objectId: mongoose.Types.ObjectId;
  /** Per-file DEK re-wrapped with the album share key (AES-GCM). */
  shareEncryptedDEK: string;
  shareKeyIv: string;
  /** File name / content type encrypted with the album share key. */
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  /** B2 object key of the thumbnail re-encrypted with the share key. */
  shareEncryptedThumbnail?: string;
}

export interface IAlbumShareLink extends Document {
  _id: mongoose.Types.ObjectId;
  token: string;
  albumId: mongoose.Types.ObjectId;
  createdBy: string;
  /** Album name encrypted with the share key. */
  shareEncryptedAlbumName?: string;
  items: IAlbumShareItem[];
  expiresAt?: Date;
  maxViews?: number;
  viewCount: number;
  isRevoked: boolean;
  isPasswordProtected: boolean;
  passwordHash?: string;
  passwordFailureCount: number;
  passwordLockedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AlbumShareItemSchema = new Schema<IAlbumShareItem>(
  {
    objectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: true,
    },
    shareEncryptedDEK: { type: String, required: true },
    shareKeyIv: { type: String, required: true },
    shareEncryptedName: { type: String, required: false },
    shareEncryptedContentType: { type: String, required: false },
    shareEncryptedThumbnail: { type: String, required: false },
  },
  { _id: false },
);

const AlbumShareLinkSchema = new Schema<IAlbumShareLink>(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(32).toString("base64url"),
      index: true,
    },
    albumId: {
      type: Schema.Types.ObjectId,
      ref: "PhotoAlbum",
      required: true,
      index: true,
    },
    createdBy: { type: String, required: true, index: true },
    shareEncryptedAlbumName: { type: String, required: false },
    items: { type: [AlbumShareItemSchema], default: [] },
    expiresAt: { type: Date, required: false },
    maxViews: { type: Number, required: false, min: 1 },
    viewCount: { type: Number, default: 0 },
    isRevoked: { type: Boolean, default: false },
    isPasswordProtected: { type: Boolean, default: false },
    passwordHash: { type: String, required: false },
    passwordFailureCount: { type: Number, default: 0 },
    passwordLockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

// MongoDB TTL — auto-deletes expired docs.
AlbumShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
AlbumShareLinkSchema.index({ createdBy: 1, createdAt: -1 });
AlbumShareLinkSchema.index({ albumId: 1, isRevoked: 1 });

const AlbumShareLink: Model<IAlbumShareLink> =
  mongoose.models.AlbumShareLink ||
  mongoose.model<IAlbumShareLink>("AlbumShareLink", AlbumShareLinkSchema);

export default AlbumShareLink;
