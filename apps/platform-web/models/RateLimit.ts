import mongoose, { Schema, Model } from "mongoose";

/**
 * RateLimit — fixed-window counter, keyed by `${action}:${subject}:${bucket}`.
 *
 * Mongo-backed so it works across serverless instances (an in-memory counter
 * wouldn't). Rows self-expire via a TTL index once their window passes.
 */
export interface IRateLimit {
  _id: string;
  count: number;
  expiresAt: Date;
}

const RateLimitSchema = new Schema<IRateLimit>(
  {
    _id: { type: String, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit: Model<IRateLimit> =
  mongoose.models.RateLimit ||
  mongoose.model<IRateLimit>("RateLimit", RateLimitSchema);

export default RateLimit;
