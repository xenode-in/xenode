import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStorageObject extends Document {
  _id: mongoose.Types.ObjectId;
  bucketId: mongoose.Types.ObjectId;
  userId: string;
  key: string;
  size: number;
  contentType: string;
  encryptedContentType?: string;
  mediaCategory: "image" | "video" | "audio" | "document" | "other";
  b2FileId: string;
  tags: string[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
  thumbnail?: string;
  /** E2EE fields — undefined on legacy plaintext files */
  isEncrypted: boolean;
  encryptedDEK?: string; // Base64 RSA-OAEP wrapped AES-256 DEK
  iv?: string; // Base64 12-byte GCM IV (legacy single-blob only)
  encryptedName?: string; // Base64 AES-GCM encrypted original filename
  encryptedDisplayName?: string; // For E2EE folders
  /** Chunked encryption fields — present only on chunked uploads (video/audio) */
  chunkSize?: number; // Plaintext bytes per chunk (e.g. 1 048 576)
  chunkCount?: number; // Total number of chunks
  chunkIvs?: string; // JSON array of Base64 12-byte IVs, one per chunk
  chunks?: {
    index: number;
    key: string;
    size: number;
  }[]; // Metadata for individual chunks
}

const StorageObjectSchema = new Schema<IStorageObject>(
  {
    bucketId: {
      type: Schema.Types.ObjectId,
      ref: "Bucket",
      required: [true, "Bucket ID is required"],
      index: true,
    },
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
    },
    key: {
      type: String,
      required: [true, "Object key is required"],
      trim: true,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    contentType: {
      type: String,
      default: "application/octet-stream",
    },
    encryptedContentType: {
      type: String,
      required: false,
    },
    encryptedDisplayName: {
      type: String,
      required: false,
    },
    mediaCategory: {
      type: String,
      enum: ["image", "video", "audio", "document", "other"],
      default: "other",
      index: true,
    },
    b2FileId: {
      type: String,
      required: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    position: {
      type: Number,
      default: 0,
    },
    thumbnail: {
      type: String,
      required: false,
    },
    isEncrypted: {
      type: Boolean,
      default: false,
      index: true,
    },
    encryptedDEK: {
      type: String,
      required: false,
    },
    iv: {
      type: String,
      required: false,
    },
    encryptedName: {
      type: String,
      required: false,
    },
    chunkSize: {
      type: Number,
      required: false,
    },
    chunkCount: {
      type: Number,
      required: false,
    },
    chunkIvs: {
      type: String, // JSON-encoded string, e.g. '["iv0b64","iv1b64",...]'
      required: false,
    },
    chunks: {
      type: [
        {
          index: { type: Number, required: true },
          key: { type: String, required: true },
          size: { type: Number, required: true },
        },
      ],
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes
 *
 * - bucketId:                single  – base bucket filter (kept)
 * - userId:                  single  – base ownership filter (kept)
 * - {bucketId, key}:         compound unique – prevents duplicate keys per bucket
 * - {bucketId, createdAt}:   compound – covers primary listing: find({bucketId}).sort({createdAt:-1})
 * - {userId, _id}:           compound – covers ownership checks: findOne({_id, userId})
 *                            and aggregate $match{userId} pipelines
 * - {key, bucketId}:         compound – enables range-prefix scans on key
 *                            (move, system-bucket folder filtering)
 * - {bucketId, position}:    compound – covers reorder queries that sort/filter by
 *                            position within a bucket; avoids in-memory sort
 * - {tags}:                  single   – enables efficient tag-based filtering
 */
StorageObjectSchema.index({ bucketId: 1, key: 1 }, { unique: true });
StorageObjectSchema.index({ bucketId: 1, createdAt: -1 });
StorageObjectSchema.index({ userId: 1, _id: 1 });
StorageObjectSchema.index({ key: 1, bucketId: 1 });
StorageObjectSchema.index({ bucketId: 1, position: 1 });
StorageObjectSchema.index({ tags: 1 });

const StorageObject: Model<IStorageObject> =
  mongoose.models.StorageObject ||
  mongoose.model<IStorageObject>("StorageObject", StorageObjectSchema);

export default StorageObject;
