import { Schema } from "mongoose";
import { getModel } from "../model";

/**
 * Fixed-window request counter for application-owned endpoints. The id binds
 * bucket, subject and window start, so each window is one atomic document.
 */
export interface RateLimitWindowRecord {
  _id: string;
  count: number;
  expiresAt: Date;
}

const rateLimitWindowSchema = new Schema<RateLimitWindowRecord>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  { collection: "rateLimitWindows", versionKey: false },
);
// Expired windows carry no state; TTL only reclaims space.
rateLimitWindowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitWindow = getModel<RateLimitWindowRecord>(
  "RateLimitWindow",
  rateLimitWindowSchema,
);
