import dbConnect from "@/lib/mongodb";
import { AuthzError } from "@/lib/authz";
import RateLimit from "@/models/RateLimit";

/**
 * Fixed-window rate limiter. Atomically increments a per-window counter and
 * throws AuthzError(429) once the limit is exceeded. Windows self-expire via the
 * TTL index on `RateLimit.expiresAt`.
 *
 * `key` should encode the action + subject, e.g. `org-invite:${userId}`.
 */
export async function enforceRateLimit(args: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<void> {
  await dbConnect();
  const bucket = Math.floor(Date.now() / args.windowMs);
  const id = `${args.key}:${bucket}`;
  const expiresAt = new Date((bucket + 1) * args.windowMs);

  const doc = await RateLimit.findByIdAndUpdate(
    id,
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true },
  );

  if (doc.count > args.limit) {
    throw new AuthzError(
      429,
      "rate_limited",
      "Too many requests — please slow down and try again shortly",
    );
  }
}
