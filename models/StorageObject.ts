import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStorageObject extends Document {
  _id: mongoose.Types.ObjectId;
  bucketId: mongoose.Types.ObjectId;
  userId: string;
  key: string;
  size: number;
  contentType: string;
  encryptedContentType?: string;
  mediaCategory: "image" | "video" | "audio" | "document" | "pdf" | "word" | "excel" | "powerpoint" | "archive" | "code" | "other";
  b2FileId: string;
  tags: string[];
  position: number;
  /** User-flagged favourite. Powers the Starred view. */
  starred?: boolean;
  /** Last time the file was opened (preview/download). Powers "Recent". */
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
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
  /** Google Photos Migration Metadata */
  takenAt?: Date;
  description?: string;
  googlePhotosUrl?: string;
  encryptedMetadata?: string; // Standardized metadata object (v0x03)
  /** Optimized image fields */
  optimizedKey?: string; // B2 key for the optimized version
  optimizedSize?: number; // Size of the optimized version
  optimizedContentType?: string; // Content type of the optimized version (e.g. image/webp)
  optimizedIV?: string; // IV for the encrypted optimized version
  optimizedEncryptedDEK?: string; // Wrapped DEK for the optimized version
  aspectRatio?: number; // width / height
  isSidecar?: boolean; // True if this file is a sidecar (like subtitle.vtt) to another asset
  parentObjectId?: mongoose.Types.ObjectId; // ID of the primary object this sidecar belongs to
  /**
   * Mobile sync fingerprints — opaque, per-user HMACs the device uploads so
   * it can tell whether a local photo is already backed up WITHOUT comparing
   * decrypted filenames (which collide on IMG_0001.jpg etc.). Both are
   * HMAC-SHA256 keyed with a value derived from the user's private key, so
   * the server can match them within a user's own bucket but learns nothing
   * about the underlying content (no plaintext oracle — preserves E2EE).
   *   - syncContentFp: HMAC(SHA-256(plaintext bytes)) — authoritative identity.
   *   - syncMetaFp:    HMAC(creationTime:size:width:height) — cheap pre-filter
   *                    computed without reading file bytes.
   */
  syncContentFp?: string;
  syncMetaFp?: string;
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
      enum: ["image", "video", "audio", "document", "pdf", "word", "excel", "powerpoint", "archive", "code", "other"],
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
    starred: {
      type: Boolean,
      default: false,
    },
    lastAccessedAt: {
      type: Date,
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
    deletedAt: {
      type: Date,
    },
    takenAt: {
      type: Date,
      required: false,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    googlePhotosUrl: {
      type: String,
      required: false,
      trim: true,
    },
    encryptedMetadata: {
      type: String,
      required: false,
    },
    aspectRatio: {
      type: Number,
      required: false,
    },
    optimizedKey: {
      type: String,
      required: false,
    },
    optimizedSize: {
      type: Number,
      required: false,
    },
    optimizedContentType: {
      type: String,
      required: false,
    },
    optimizedIV: {
      type: String,
      required: false,
    },
    optimizedEncryptedDEK: {
      type: String,
      required: false,
    },
    isSidecar: {
      type: Boolean,
      default: false,
      index: true,
    },
    parentObjectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: false,
      index: true,
    },
    syncContentFp: {
      type: String,
      required: false,
    },
    syncMetaFp: {
      type: String,
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
StorageObjectSchema.index({
  bucketId: 1,
  deletedAt: 1,
  createdAt: -1,
  _id: -1,
});
StorageObjectSchema.index({ bucketId: 1, deletedAt: 1, size: -1, _id: -1 });
StorageObjectSchema.index({
  bucketId: 1,
  deletedAt: 1,
  contentType: 1,
  _id: -1,
});
// Bin purge support. This is a PLAIN index, deliberately NOT a TTL: the 30-day
// purge runs through /api/cron/purge-bin so it can delete the encrypted B2
// blobs *before* removing the document — a TTL would drop the doc and orphan
// the blobs forever. Supports the cron's cross-bucket "deletedAt <= cutoff"
// age scan; per-bucket Bin listing is already covered by the
// {bucketId, deletedAt, createdAt, _id} index below.
//
// ⚠️ DEPLOY NOTE: the previous TTL index (name `deletedAt_1`, expireAfterSeconds
// 2592000) must be dropped in production once — otherwise Mongo keeps
// auto-removing binned docs at 30 days and orphans their B2 blobs:
//     db.storageobjects.dropIndex("deletedAt_1")
// then this plain index is (re)created on next deploy.
StorageObjectSchema.index({ deletedAt: 1 });

// Starred view: list a bucket's favourites newest-first. Partial index keeps it
// tiny — only starred docs are indexed — and the query always carries
// `starred: true`, so Mongo can use it.
StorageObjectSchema.index(
  { bucketId: 1, createdAt: -1 },
  { partialFilterExpression: { starred: true }, name: "starred_objects" },
);

// Recent view: list a bucket's files by most-recently-opened.
StorageObjectSchema.index({ bucketId: 1, lastAccessedAt: -1 });

// Mobile sync dedup lookups — sparse so only fingerprinted (mobile-uploaded)
// objects occupy the index. Covers the /api/objects/sync-check $in queries.
StorageObjectSchema.index(
  { bucketId: 1, syncContentFp: 1 },
  { sparse: true },
);
StorageObjectSchema.index(
  { bucketId: 1, syncMetaFp: 1 },
  { sparse: true },
);

if (mongoose.models.StorageObject) {
  delete mongoose.models.StorageObject;
}
const StorageObject: Model<IStorageObject> = mongoose.model<IStorageObject>("StorageObject", StorageObjectSchema);

export default StorageObject;
