import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * OrgMembershipHistory — an append-only tombstone recording that a user was
 * once a member of an organization and has left/been removed.
 *
 * The live `member` collection is hard-deleted on removal, so this is the only
 * queryable record that an email previously belonged to the org. Used to warn
 * admins when the same email is re-invited (e.g. a corporate address reassigned
 * to a new hire) — the returning/new person is always treated as brand-new and
 * granted the CURRENT space-key version, never the rotated-out one.
 *
 * Written fire-and-forget (like `emitActivity`) — failures must never block the
 * removal it records.
 */
export interface IOrgMembershipHistory extends Document {
  _id: mongoose.Types.ObjectId;
  orgId: string;
  userId: string;
  email?: string | null;
  role?: string | null;
  joinedAt?: Date | null;
  removedAt: Date;
  removedBy?: string | null;
  reason?: "removed" | "left";
  createdAt: Date;
  updatedAt: Date;
}

const OrgMembershipHistorySchema = new Schema<IOrgMembershipHistory>(
  {
    orgId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    email: { type: String, default: null, lowercase: true },
    role: { type: String, default: null },
    joinedAt: { type: Date, default: null },
    removedAt: { type: Date, required: true },
    removedBy: { type: String, default: null },
    reason: { type: String, enum: ["removed", "left"], default: "removed" },
  },
  { timestamps: true },
);

OrgMembershipHistorySchema.index({ orgId: 1, email: 1, removedAt: -1 });
OrgMembershipHistorySchema.index({ orgId: 1, userId: 1, removedAt: -1 });

const OrgMembershipHistory: Model<IOrgMembershipHistory> =
  mongoose.models.OrgMembershipHistory ||
  mongoose.model<IOrgMembershipHistory>(
    "OrgMembershipHistory",
    OrgMembershipHistorySchema,
  );

export default OrgMembershipHistory;
