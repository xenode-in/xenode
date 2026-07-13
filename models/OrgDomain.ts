import mongoose, { Document, Model, Schema } from "mongoose";

export type OrgDomainStatus = "pending" | "verified" | "failed";

export interface IOrgDomain extends Document {
  orgId: string;
  domain: string;
  verificationToken: string;
  status: OrgDomainStatus;
  method: "dns_txt";
  createdBy: string;
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OrgDomainSchema = new Schema<IOrgDomain>(
  {
    orgId: { type: String, required: true, index: true },
    domain: { type: String, required: true, lowercase: true, trim: true },
    verificationToken: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending",
      index: true,
    },
    method: { type: String, enum: ["dns_txt"], default: "dns_txt" },
    createdBy: { type: String, required: true, index: true },
    verifiedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

OrgDomainSchema.index({ orgId: 1, domain: 1 }, { unique: true });
OrgDomainSchema.index({ domain: 1, status: 1 });

const OrgDomain: Model<IOrgDomain> =
  mongoose.models.OrgDomain ||
  mongoose.model<IOrgDomain>("OrgDomain", OrgDomainSchema);

export default OrgDomain;
