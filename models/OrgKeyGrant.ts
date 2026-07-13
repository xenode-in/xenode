import mongoose, { Document, Model, Schema } from "mongoose";

export interface IOrgKeyGrant extends Document {
  _id: mongoose.Types.ObjectId;
  orgId: string;
  teamId?: string | null;
  memberUserId: string;
  wrappedSpaceKey: string;
  keyVersion: number;
  wrappedByUserId: string;
  createdBy: string;
  revokedAt?: Date;
  rotationReason?: "initial" | "member_added" | "member_removed" | "manual";
  createdAt: Date;
  updatedAt: Date;
}

const OrgKeyGrantSchema = new Schema<IOrgKeyGrant>(
  {
    orgId: { type: String, required: true, index: true },
    teamId: { type: String, required: false, index: true },
    memberUserId: { type: String, required: true, index: true },
    wrappedSpaceKey: { type: String, required: true },
    keyVersion: { type: Number, required: true, min: 1 },
    wrappedByUserId: { type: String, required: true, index: true },
    createdBy: { type: String, required: true, index: true },
    revokedAt: { type: Date, required: false, index: true },
    rotationReason: {
      type: String,
      enum: ["initial", "member_added", "member_removed", "manual"],
      required: false,
    },
  },
  { timestamps: true },
);

OrgKeyGrantSchema.index(
  { orgId: 1, teamId: 1, memberUserId: 1, keyVersion: 1 },
  { unique: true },
);
OrgKeyGrantSchema.index({ orgId: 1, memberUserId: 1, keyVersion: -1 });
OrgKeyGrantSchema.index({ orgId: 1, teamId: 1, keyVersion: -1 });

const OrgKeyGrant: Model<IOrgKeyGrant> =
  mongoose.models.OrgKeyGrant ||
  mongoose.model<IOrgKeyGrant>("OrgKeyGrant", OrgKeyGrantSchema);

export default OrgKeyGrant;
