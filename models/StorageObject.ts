import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStorageObject extends Document {
  _id: mongoose.Types.ObjectId;
  bucketId: mongoose.Types.ObjectId;
  userId: string;
  key: string;
  size: number;
  contentType: string;
  b2FileId: string;
  tags: string[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
  thumbnail?: string;
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
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes
 *
 * - bucketId:              single – base bucket filter (kept)
 * - userId:                single – base ownership filter (kept)
 * - {bucketId, key}:       compound unique – prevents duplicate keys per bucket
 * - {bucketId, createdAt}: compound – covers primary listing: find({bucketId}).sort({createdAt:-1})
 * - {userId, _id}:         compound – covers ownership checks: findOne({_id, userId})
 *                          and aggregate $match{userId} pipelines
 * - {key, bucketId}:       compound – enables regex-prefix scans on key
 *                          (move, system-bucket folder filtering)
 */
StorageObjectSchema.index({ bucketId: 1, key: 1 }, { unique: true });
StorageObjectSchema.index({ bucketId: 1, createdAt: -1 });
StorageObjectSchema.index({ userId: 1, _id: 1 });
StorageObjectSchema.index({ key: 1, bucketId: 1 });

const StorageObject: Model<IStorageObject> =
  mongoose.models.StorageObject ||
  mongoose.model<IStorageObject>("StorageObject", StorageObjectSchema);

export default StorageObject;
