import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBucket extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  ownerScope?: "personal" | "organization" | "team";
  orgId?: string;
  teamId?: string;
  createdBy?: string;
  name: string;
  b2BucketId: string;
  region: string;
  objectCount: number;
  totalSizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

const BucketSchema = new Schema<IBucket>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
    },
    ownerScope: {
      type: String,
      enum: ["personal", "organization", "team"],
      default: "personal",
      index: true,
    },
    orgId: {
      type: String,
      required: false,
      index: true,
    },
    teamId: {
      type: String,
      required: false,
      index: true,
    },
    createdBy: {
      type: String,
      required: false,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Bucket name is required"],
      trim: true,
      lowercase: true,
      match: [
        /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
        "Bucket name must be 3-63 characters, lowercase alphanumeric and hyphens only",
      ],
    },
    b2BucketId: {
      type: String,
      required: true,
      index: true,
    },
    region: {
      type: String,
      default: "us-west-004",
    },
    objectCount: {
      type: Number,
      default: 0,
    },
    totalSizeBytes: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes
 *
 * - userId:              single – base ownership filter
 * - b2BucketId:          non-unique lookup. NOT unique: in the shared-bucket
 *                        model many logical buckets (all orgs/teams) point at
 *                        the same physical B2 bucket; isolation is by key prefix.
 * - Name uniqueness is SCOPE-AWARE (partial indexes). A global {userId,name}
 *   unique would break org/team buckets, which all share userId "org:{orgId}"
 *   yet legitimately reuse the name "workspace" per team.
 * - {userId, createdAt}: compound – covers list queries.
 */
BucketSchema.index(
  { userId: 1, name: 1 },
  { unique: true, partialFilterExpression: { ownerScope: "personal" } },
);
BucketSchema.index(
  { orgId: 1, name: 1 },
  { unique: true, partialFilterExpression: { ownerScope: "organization" } },
);
BucketSchema.index(
  { orgId: 1, teamId: 1, name: 1 },
  { unique: true, partialFilterExpression: { ownerScope: "team" } },
);
BucketSchema.index({ userId: 1, createdAt: -1 });
BucketSchema.index({ ownerScope: 1, orgId: 1, createdAt: -1 });
BucketSchema.index({ ownerScope: 1, teamId: 1, createdAt: -1 });

const Bucket: Model<IBucket> =
  mongoose.models.Bucket || mongoose.model<IBucket>("Bucket", BucketSchema);

export default Bucket;
