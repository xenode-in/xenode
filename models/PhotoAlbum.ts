import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPhotoAlbum extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  name: string;
  slug: string;
  description?: string;
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
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
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

const PhotoAlbum: Model<IPhotoAlbum> =
  mongoose.models.PhotoAlbum ||
  mongoose.model<IPhotoAlbum>("PhotoAlbum", PhotoAlbumSchema);

export default PhotoAlbum;
