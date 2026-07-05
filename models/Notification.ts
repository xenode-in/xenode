import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Notification — a per-user, in-app inbox item.
 *
 * Recipient-scoped (`userId`). Written fire-and-forget by `emitNotification`.
 * Payload carries only opaque ids / enums (no plaintext file names or PII).
 */
export type NotificationType =
  | "invite_received"
  | "invite_accepted"
  | "role_changed"
  | "access_request"
  | "access_request_decided"
  | "member_removed"
  | "billing_issue";

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  orgId?: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: null },
    orgId: { type: String, default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

const Notification: Model<INotification> =
  mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema);

export default Notification;
