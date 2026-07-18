import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPhotoAlbum extends Document {
  _id: mongoose.Types.ObjectId;
  spaceId: string;
  createdByAccountId: string;
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
    spaceId: {
      type: String,
      required: true,
      index: true,
    },
    createdByAccountId: {
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

PhotoAlbumSchema.index({ spaceId: 1, updatedAt: -1 });
PhotoAlbumSchema.index({ spaceId: 1, slug: 1 }, { unique: true });
// One cloud album per device-album reference per Space. The partial filter
// restricts it to docs that have a sourceRef, so albums created on the web
// (no sourceRef) never collide.
PhotoAlbumSchema.index(
  { spaceId: 1, sourceRef: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceRef: { $type: "string" } },
  },
);

const PhotoAlbum: Model<IPhotoAlbum> =
  mongoose.models.PhotoAlbum ||
  mongoose.model<IPhotoAlbum>("PhotoAlbum", PhotoAlbumSchema);

export default PhotoAlbum;
