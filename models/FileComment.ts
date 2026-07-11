import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * FileComment — an end-to-end-encrypted comment on a direct-shared file.
 *
 * The comment body is encrypted client-side with the share's AES key (the same
 * key wrapped per-recipient as `wrappedShareKey`), so only the share's
 * participants can read it. The server stores opaque ciphertext only.
 */
export interface IFileComment extends Document {
  _id: mongoose.Types.ObjectId;
  directShareId: mongoose.Types.ObjectId;
  objectId: mongoose.Types.ObjectId;
  authorUserId: string;
  authorEmail?: string | null;
  /** AES-GCM ciphertext (iv-prefixed, base64) of the comment text. */
  ciphertext: string;
  createdAt: Date;
  updatedAt: Date;
}

const FileCommentSchema = new Schema<IFileComment>(
  {
    directShareId: {
      type: Schema.Types.ObjectId,
      ref: "DirectShare",
      required: true,
      index: true,
    },
    objectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: true,
      index: true,
    },
    authorUserId: { type: String, required: true, index: true },
    authorEmail: { type: String, default: null },
    ciphertext: { type: String, required: true },
  },
  { timestamps: true },
);

FileCommentSchema.index({ directShareId: 1, createdAt: 1 });

const FileComment: Model<IFileComment> =
  mongoose.models.FileComment ||
  mongoose.model<IFileComment>("FileComment", FileCommentSchema);

export default FileComment;
