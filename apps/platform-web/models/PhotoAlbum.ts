import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPhotoAlbum extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  slug: string;
  description?: string;
  /** E2EE album name: AES-GCM under the user's metadataKey. */
  encryptedName?: string;
  /**
   * Opaque client-derived stable reference for a mirrored device album
   * (keyed HMAC — the server cannot recover the device album title).
   * Enables idempotent upsert from mobile backup across devices/reinstalls.
   */
  sourceRef?: string;
  objectIds: mongoose.Types.ObjectId[];
  coverObjectId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PhotoAlbumSchema = new Schema<IPhotoAlbum>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    encryptedName: {
      type: String,
      trim: true,
      maxlength: 2048,
      required: false,
    },
    sourceRef: {
      type: String,
      trim: true,
      maxlength: 128,
      required: false,
    },
    objectIds: {
      type: [Schema.Types.ObjectId],
      ref: "StorageObject",
      default: [],
    },
    coverObjectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

PhotoAlbumSchema.index({ userId: 1, updatedAt: -1 });
// Slugs are unique per user so a slug resolves to exactly one album.
PhotoAlbumSchema.index({ userId: 1, slug: 1 }, { unique: true });
// One cloud album per device-album reference per user. Partial (not sparse):
// a sparse compound index would still index every doc because userId is
// always present; the partial filter restricts it to docs that have a
// sourceRef, so albums created on the web (no sourceRef) never collide.
PhotoAlbumSchema.index(
  { userId: 1, sourceRef: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceRef: { $type: "string" } },
  },
);

const PhotoAlbum: Model<IPhotoAlbum> =
  mongoose.models.PhotoAlbum ||
  mongoose.model<IPhotoAlbum>("PhotoAlbum", PhotoAlbumSchema);

export default PhotoAlbum;
