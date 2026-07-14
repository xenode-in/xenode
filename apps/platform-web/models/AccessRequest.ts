import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * AccessRequest — a member/guest asking for access to an org resource they
 * can't currently open. Admins triage these from the Requests queue. The record
 * is the request/decision ledger; the actual encrypted grant (a DirectShare
 * with a client-wrapped key) is issued through the normal sharing flow after
 * approval (E2EE: the server can't mint the key itself).
 */
export type AccessRequestResource = "object" | "bucket" | "team" | "org_membership";
export type AccessRequestStatus = "pending" | "approved" | "denied";

export interface IAccessRequest extends Document {
  _id: mongoose.Types.ObjectId;
  orgId: string;
  requesterUserId: string;
  resourceType: AccessRequestResource;
  resourceId: string | null;
  note?: string | null;
  status: AccessRequestStatus;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AccessRequestSchema = new Schema<IAccessRequest>(
  {
    orgId: { type: String, required: true, index: true },
    requesterUserId: { type: String, required: true, index: true },
    resourceType: {
      type: String,
      enum: ["object", "bucket", "team", "org_membership"],
      required: true,
    },
    resourceId: { type: String, default: null },
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

AccessRequestSchema.index({ orgId: 1, status: 1, createdAt: -1 });
AccessRequestSchema.index({ orgId: 1, requesterUserId: 1, createdAt: -1 });

const AccessRequest: Model<IAccessRequest> =
  mongoose.models.AccessRequest ||
  mongoose.model<IAccessRequest>("AccessRequest", AccessRequestSchema);

export default AccessRequest;
