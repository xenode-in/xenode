import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * IdempotencyKey — stores the response of a billing mutation so retries
 * (e.g. a user double-clicks "Subscribe") return the same outcome without
 * re-creating Razorpay objects or duplicate DB rows.
 *
 * Scope: (userId, route, key). Keys are user-provided via `Idempotency-Key`
 * request header. TTL: 24h.
 */

export interface IIdempotencyKey extends Document {
  userId: string;
  route: string;
  key: string;
  /** SHA-256 of the canonicalized request body; protects against key reuse with different payloads */
  requestHash: string;
  status: "in_flight" | "completed" | "failed";
  responseStatus: number | null;
  responseBody: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    userId: { type: String, required: true },
    route: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["in_flight", "completed", "failed"],
      default: "in_flight",
    },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

IdempotencyKeySchema.index(
  { userId: 1, route: 1, key: 1 },
  { unique: true },
);
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const IdempotencyKey: Model<IIdempotencyKey> =
  mongoose.models.IdempotencyKey ||
  mongoose.model<IIdempotencyKey>("IdempotencyKey", IdempotencyKeySchema);

export default IdempotencyKey;
