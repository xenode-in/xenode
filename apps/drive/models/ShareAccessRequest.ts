import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * ShareAccessRequest — a Google-Drive-style "request access" on a direct share.
 *
 * A recipient who holds a file at the `viewer` role can ask the owner to upgrade
 * them to `commenter` or `editor`. Anchored on `directShareId` so it works
 * uniformly for personal and org shares. Approval flips the recipient's
 * `accessType` on the DirectShare — no key work, since the share key is already
 * wrapped for them.
 */
export type ShareRequestRole = "commenter" | "editor";

export interface IShareAccessRequest extends Document {
  _id: mongoose.Types.ObjectId;
  directShareId: mongoose.Types.ObjectId;
  objectId: mongoose.Types.ObjectId;
  requesterUserId: string;
  requesterEmail?: string | null;
  /** Share creator — the primary approver; enables the owner's inbox query. */
  ownerUserId: string;
  /** Set when the shared object belongs to an org (enables admin triage). */
  orgId?: string | null;
  currentRole: string;
  requestedRole: ShareRequestRole;
  note?: string | null;
  status: "pending" | "approved" | "denied";
  decidedBy?: string | null;
  decidedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShareAccessRequestSchema = new Schema<IShareAccessRequest>(
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
    },
    requesterUserId: { type: String, required: true, index: true },
    requesterEmail: { type: String, default: null },
    ownerUserId: { type: String, required: true, index: true },
    orgId: { type: String, default: null, index: true },
    currentRole: { type: String, required: true },
    requestedRole: {
      type: String,
      enum: ["commenter", "editor"],
      required: true,
    },
    note: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "approved", "denied"],
      default: "pending",
      index: true,
    },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ShareAccessRequestSchema.index({ ownerUserId: 1, status: 1, createdAt: -1 });
ShareAccessRequestSchema.index({ requesterUserId: 1, status: 1, createdAt: -1 });
ShareAccessRequestSchema.index({ directShareId: 1, requesterUserId: 1, status: 1 });

const ShareAccessRequest: Model<IShareAccessRequest> =
  mongoose.models.ShareAccessRequest ||
  mongoose.model<IShareAccessRequest>(
    "ShareAccessRequest",
    ShareAccessRequestSchema,
  );

export default ShareAccessRequest;
