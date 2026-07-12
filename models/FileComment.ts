import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * FileComment — an end-to-end-encrypted comment on a stored file (Google
 * Drive-style: the thread belongs to the FILE, not to a particular share).
 *
 * The comment payload is encrypted client-side with the file's DEK, which
 * every legitimate participant can derive: the owner unwraps `encryptedDEK`
 * (RSA or workspace space key) and share recipients unwrap it through their
 * share-key chain. The server stores opaque ciphertext only. The ciphertext
 * is an AES-GCM-encrypted JSON payload `{ body, anchor? }` so even the anchor
 * (sheet/cell reference) stays hidden from the server. This keys comments to
 * the object, so the same model serves future editors (documents, etc.).
 *
 * Threading: root comments have `parentId: null` and carry the thread status
 * (open/resolved); replies reference their root via `parentId`.
 */
export interface IFileComment extends Document {
  _id: mongoose.Types.ObjectId;
  objectId: mongoose.Types.ObjectId;
  /** Share context the author posted from, when they are a recipient. */
  directShareId?: mongoose.Types.ObjectId | null;
  /** Root comment of the thread; null for thread roots. */
  parentId?: mongoose.Types.ObjectId | null;
  authorUserId: string;
  authorEmail?: string | null;
  /** AES-GCM ciphertext (iv-prefixed, base64) of JSON { body, anchor? }. */
  ciphertext: string;
  /** Thread status — only meaningful on root comments. */
  status: "open" | "resolved";
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const FileCommentSchema = new Schema<IFileComment>(
  {
    objectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: true,
      index: true,
    },
    directShareId: {
      type: Schema.Types.ObjectId,
      ref: "DirectShare",
      default: null,
      index: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "FileComment",
      default: null,
      index: true,
    },
    authorUserId: { type: String, required: true, index: true },
    authorEmail: { type: String, default: null },
    ciphertext: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
    },
    resolvedBy: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

FileCommentSchema.index({ objectId: 1, createdAt: 1 });
FileCommentSchema.index({ objectId: 1, parentId: 1, createdAt: 1 });

const FileComment: Model<IFileComment> =
  mongoose.models.FileComment ||
  mongoose.model<IFileComment>("FileComment", FileCommentSchema);

export default FileComment;
