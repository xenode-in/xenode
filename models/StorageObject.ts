import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStorageObject extends Document {
  _id: mongoose.Types.ObjectId;
  bucketId: mongoose.Types.ObjectId;
  userId: string;
  key: string;
  size: number;
  contentType: string;
  b2FileId: string;
  createdAt: Date;
  updatedAt: Date;
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
  },
  {
    timestamps: true,
  },
);

// Compound index for bucket + key uniqueness
StorageObjectSchema.index({ bucketId: 1, key: 1 }, { unique: true });

const StorageObject: Model<IStorageObject> =
  mongoose.models.StorageObject ||
  mongoose.model<IStorageObject>("StorageObject", StorageObjectSchema);

export default StorageObject;
