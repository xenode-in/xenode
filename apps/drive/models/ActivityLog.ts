import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * ActivityLog — append-only, immutable audit trail for an organization.
 *
 * Every meaningful org transition (member invited/joined/removed, domain
 * verified, file uploaded, billing changed, settings updated, …) emits one row.
 * Never mutated, never deleted (org purge aside). Partitioned by `orgId`.
 *
 * Payload MUST NOT contain raw PII or plaintext file names/keys — store opaque
 * ids, size buckets, roles, and enums only (enforced via `lib/audit/sanitize`).
 */

export type ActivityActorType = "user" | "system" | "webhook";

export interface IActivityTarget {
  type: string;
  id: string | null;
}

export interface IActivityLog extends Document {
  _id: mongoose.Types.ObjectId;
  orgId: string;
  /** Actor who caused the event; null for system/automated events. */
  actorUserId: string | null;
  actorType: ActivityActorType;
  /** Dot-namespaced action, e.g. "member.joined", "file.uploaded". */
  action: string;
  target: IActivityTarget | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const ActivityTargetSchema = new Schema<IActivityTarget>(
  {
    type: { type: String, required: true },
    id: { type: String, default: null },
  },
  { _id: false },
);

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    orgId: { type: String, required: true, index: true },
    actorUserId: { type: String, default: null, index: true },
    actorType: {
      type: String,
      enum: ["user", "system", "webhook"],
      default: "user",
    },
    action: { type: String, required: true, index: true },
    target: { type: ActivityTargetSchema, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ActivityLogSchema.index({ orgId: 1, createdAt: -1 });
ActivityLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });
ActivityLogSchema.index({ orgId: 1, actorUserId: 1, createdAt: -1 });

const ActivityLog: Model<IActivityLog> =
  mongoose.models.ActivityLog ||
  mongoose.model<IActivityLog>("ActivityLog", ActivityLogSchema);

export default ActivityLog;
