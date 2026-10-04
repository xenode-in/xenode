import { RateLimitWindow } from "../models/rate-limit";

export interface RateLimitRule {
  /** Stable name of the protected operation, e.g. "account-password". */
  bucket: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function isDuplicateKey(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Count one request for `subject` (an account ID or other stable key) in the
 * rule's current fixed window. The increment is a single atomic upsert, so
 * concurrent requests cannot exceed the limit by reading a stale count.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitDecision> {
  if (
    !Number.isSafeInteger(rule.limit) ||
    rule.limit < 1 ||
    !Number.isSafeInteger(rule.windowMs) ||
    rule.windowMs < 1000 ||
    !rule.bucket ||
    !subject
  ) {
    throw new Error("Invalid rate limit rule");
  }
  const windowStart =
    Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
  const windowEnd = windowStart + rule.windowMs;
  const id = `${rule.bucket}\u001f${subject}\u001f${windowStart}`;
  const increment = () =>
    RateLimitWindow.findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date(windowEnd + rule.windowMs) },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();
  let window;
  try {
    window = await increment();
  } catch (error) {
    // Two first requests can race to insert the same window; retry once.
    if (!isDuplicateKey(error)) throw error;
    window = await increment();
  }
  const count = window?.count ?? rule.limit + 1;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowEnd - now.getTime()) / 1000),
    ),
  };
}
