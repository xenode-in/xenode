import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * BillingEvent — append-only audit + analytics log for the billing domain.
 *
 * Every meaningful billing state transition (subscription created, plan changed,
 * webhook processed, coupon redeemed, refund issued, admin action, etc.) emits
 * one row here. Reads are analytics; writes are durable, never mutated.
 *
 * Payload MUST NOT contain raw PII (email/phone/name). Store opaque IDs and amounts.
 */

export type BillingEventActorType = "user" | "admin" | "system" | "webhook";

export interface IBillingEvent extends Document {
  _id: mongoose.Types.ObjectId;
  /** Dot-namespaced event type, e.g. "subscription.created", "coupon.redeemed" */
  type: string;
  /** Subject user — denormalized for fast per-user audit queries. May be null for system-only events. */
  userId: string | null;
  actorType: BillingEventActorType;
  /** ID of the actor — userId, adminId, webhook eventId, or "cron" for scheduled */
  actorId: string | null;
  /** What the event is about (e.g. "subscription", "payment", "coupon", "campaign") */
  subjectType: string;
  /** Document id or external id of the subject */
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

const BillingEventSchema = new Schema<IBillingEvent>(
  {
    type: { type: String, required: true, index: true },
    userId: { type: String, default: null, index: true },
    actorType: {
      type: String,
      enum: ["user", "admin", "system", "webhook"],
      required: true,
    },
    actorId: { type: String, default: null },
    subjectType: { type: String, required: true },
    subjectId: { type: String, default: null, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

BillingEventSchema.index({ userId: 1, createdAt: -1 });
BillingEventSchema.index({ type: 1, createdAt: -1 });

const BillingEvent: Model<IBillingEvent> =
  mongoose.models.BillingEvent ||
  mongoose.model<IBillingEvent>("BillingEvent", BillingEventSchema);

export default BillingEvent;
