import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * UploadSession — a short-lived ledger of an in-flight direct-to-B2 upload.
 *
 * Uploads write encrypted bytes straight to B2 (chunk objects, thumbnail,
 * optimized preview, main blob) BEFORE any StorageObject document exists — that
 * document is only created at `complete-upload` after every byte is verified.
 * If the upload is abandoned (tab closed, device locked past the resume window,
 * crash), those blobs become orphans with nothing referencing them.
 *
 * This ledger records every B2 key an upload intends to write, keyed by the
 * logical `fileId`. `complete-upload` flips it to `completed`; the
 * `cleanup-orphans` cron deletes the B2 keys of any session still `pending`
 * after `expiresAt` and then removes the row.
 *
 * NOTE: deliberately NO TTL index — a TTL would drop the row and orphan the
 * blobs forever (same reasoning as StorageObject.deletedAt). The cron must
 * delete the B2 objects first, then the row.
 */
export interface IUploadSession extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  bucketId: mongoose.Types.ObjectId;
  /** Logical/main object key, e.g. `users/{userId}/{uuid}`. Stable across resume. */
  fileId: string;
  /** Every B2 key this upload writes: main, `${fileId}-chunk-{i}`, `${fileId}-thumb`, optimized key. */
  keys: string[];
  status: "pending" | "completed";
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UploadSessionSchema = new Schema<IUploadSession>(
  {
    userId: { type: String, required: true, index: true },
    bucketId: {
      type: Schema.Types.ObjectId,
      ref: "Bucket",
      required: true,
    },
    fileId: { type: String, required: true },
    keys: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One ledger row per logical upload key per bucket — lets presign upsert cleanly
// and lets resume/complete look it up deterministically.
UploadSessionSchema.index({ bucketId: 1, fileId: 1 }, { unique: true });
// Drives the cleanup-orphans cron scan: pending sessions past their deadline.
UploadSessionSchema.index({ status: 1, expiresAt: 1 });

if (mongoose.models.UploadSession) {
  delete mongoose.models.UploadSession;
}
const UploadSession: Model<IUploadSession> = mongoose.model<IUploadSession>(
  "UploadSession",
  UploadSessionSchema,
);

export default UploadSession;
