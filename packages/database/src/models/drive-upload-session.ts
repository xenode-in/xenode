import { Schema, type Types } from "mongoose";
import { getModel } from "../model";

export interface DriveUploadSessionRecord {
  _id: Types.ObjectId;
  userId: string;
  spaceId: string;
  bucketId: Types.ObjectId;
  fileId: string;
  keys: string[];
  purpose: "create" | "revision";
  targetObjectId?: Types.ObjectId;
  baseRevision?: number;
  revisionSize?: number;
  revisionIv?: string;
  authorizationShareId?: Types.ObjectId;
  committedRevision?: number;
  status: "pending" | "completing" | "completed" | "cleaning" | "blocked";
  committedKeys: string[];
  cleanupState: "pending" | "cleaning" | "blocked" | "done";
  cleanupLeaseId?: string;
  cleanupLeaseExpiresAt?: Date;
  cleanupNextAttemptAt?: Date;
  cleanupCompletedAt?: Date;
  cleanupError?: string;
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
  purpose: { type: String, enum: ["create", "revision"], default: "create", required: true },
  targetObjectId: Schema.Types.ObjectId,
  baseRevision: Number,
  revisionSize: Number,
  revisionIv: String,
  authorizationShareId: Schema.Types.ObjectId,
  committedRevision: Number,
  status: { type: String, enum: ["pending", "completing", "completed", "cleaning", "blocked"], default: "pending" },
  committedKeys: { type: [String], default: [] },
  cleanupState: { type: String, enum: ["pending", "cleaning", "blocked", "done"], default: "pending" },
  cleanupLeaseId: String,
  cleanupLeaseExpiresAt: Date,
  cleanupNextAttemptAt: Date,
  cleanupCompletedAt: Date,
  cleanupError: String,
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: "uploadsessions" });

schema.index({ bucketId: 1, fileId: 1 }, { unique: true });
// Keep completed claims: a physical key cannot be reused by another upload.
schema.index({ bucketId: 1, keys: 1 }, { unique: true });
schema.index({ targetObjectId: 1, revisionIv: 1 }, {
  unique: true, partialFilterExpression: { purpose: "revision" }, name: "unique_revision_iv",
});
schema.index({ status: 1, expiresAt: 1 });
schema.index({ cleanupState: 1, expiresAt: 1, cleanupNextAttemptAt: 1 });
// No TTL: ciphertext must be removed before its cleanup ledger is discarded.
export const DriveUploadSession = getModel<DriveUploadSessionRecord>("UploadSession", schema);
