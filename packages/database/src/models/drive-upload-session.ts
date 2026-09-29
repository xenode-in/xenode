import { Schema, type Types } from "mongoose";
import { getModel } from "../model";

export interface DriveUploadSessionRecord {
  _id: Types.ObjectId;
  userId: string;
  spaceId: string;
  bucketId: Types.ObjectId;
  fileId: string;
  keys: string[];
  status: "pending" | "completing" | "completed";
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<DriveUploadSessionRecord>({
  userId: { type: String, required: true, index: true },
  spaceId: { type: String, required: true, index: true },
  bucketId: { type: Schema.Types.ObjectId, required: true },
  fileId: { type: String, required: true },
  keys: { type: [String], default: [] },
  status: { type: String, enum: ["pending", "completing", "completed"], default: "pending" },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: "uploadsessions" });

schema.index({ bucketId: 1, fileId: 1 }, { unique: true });
// Keep completed claims: a physical key cannot be reused by another upload.
schema.index({ bucketId: 1, keys: 1 }, { unique: true });
schema.index({ status: 1, expiresAt: 1 });
// No TTL: ciphertext must be removed before its cleanup ledger is discarded.
export const DriveUploadSession = getModel<DriveUploadSessionRecord>("UploadSession", schema);
