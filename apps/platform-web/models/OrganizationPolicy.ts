import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * OrganizationPolicy — org-wide external-sharing controls.
 *
 * A dedicated model (one doc per org) so sharing rules can be enforced
 * server-side in share routes without overloading the org doc. Defaults are
 * permissive-but-safe; admins tighten them per org.
 */
export interface IOrganizationPolicy extends Document {
  _id: mongoose.Types.ObjectId;
  orgId: string;
  allowPublicLinks: boolean;
  allowGuests: boolean;
  allowExternalUploads: boolean;
  requirePassword: boolean;
  requireExpiry: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationPolicySchema = new Schema<IOrganizationPolicy>(
  {
    orgId: { type: String, required: true, unique: true, index: true },
    allowPublicLinks: { type: Boolean, default: true },
    allowGuests: { type: Boolean, default: true },
    allowExternalUploads: { type: Boolean, default: false },
    requirePassword: { type: Boolean, default: false },
    requireExpiry: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const OrganizationPolicy: Model<IOrganizationPolicy> =
  mongoose.models.OrganizationPolicy ||
  mongoose.model<IOrganizationPolicy>(
    "OrganizationPolicy",
    OrganizationPolicySchema,
  );

export default OrganizationPolicy;
