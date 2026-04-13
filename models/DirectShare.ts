import mongoose, { Document, Model, Schema } from "mongoose";

export interface IDirectShareRecipient {
  recipientUserId: string;
  recipientEmail: string;
  wrappedShareKey: string;
  accessType: "view" | "download";
  downloadCount: number;
  lastAccessedAt?: Date;
}

export interface IDirectShare extends Document {
  _id: mongoose.Types.ObjectId;
  objectId: mongoose.Types.ObjectId;
  bucketId: mongoose.Types.ObjectId;
  createdBy: string;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  shareEncryptedThumbnail?: string;
  recipients: IDirectShareRecipient[];
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DirectShareRecipientSchema = new Schema<IDirectShareRecipient>(
  {
    recipientUserId: { type: String, required: true, index: true },
    recipientEmail: { type: String, required: true },
    wrappedShareKey: { type: String, required: true },
    accessType: {
      type: String,
      enum: ["view", "download"],
      default: "download",
    },
    downloadCount: { type: Number, default: 0 },
    lastAccessedAt: { type: Date, required: false },
  },
  { _id: false },
);

const DirectShareSchema = new Schema<IDirectShare>(
  {
    objectId: {
      type: Schema.Types.ObjectId,
      ref: "StorageObject",
      required: true,
      index: true,
    },
    bucketId: {
      type: Schema.Types.ObjectId,
      ref: "Bucket",
      required: true,
      index: true,
    },
    createdBy: { type: String, required: true, index: true },
    shareEncryptedDEK: { type: String, required: false },
    shareKeyIv: { type: String, required: false },
    shareEncryptedName: { type: String, required: false },
    shareEncryptedContentType: { type: String, required: false },
    shareEncryptedThumbnail: { type: String, required: false },
    recipients: {
      type: [DirectShareRecipientSchema],
      default: [],
      validate: {
        validator: (value: IDirectShareRecipient[]) => Array.isArray(value) && value.length > 0,
        message: "At least one recipient is required",
      },
    },
    isRevoked: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

DirectShareSchema.index({ createdBy: 1, createdAt: -1 });
DirectShareSchema.index({ "recipients.recipientUserId": 1, isRevoked: 1, createdAt: -1 });

const DirectShare: Model<IDirectShare> =
  mongoose.models.DirectShare ||
  mongoose.model<IDirectShare>("DirectShare", DirectShareSchema);

export default DirectShare;
