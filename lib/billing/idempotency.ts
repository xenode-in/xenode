import crypto from "crypto";
import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import IdempotencyKey from "@/models/IdempotencyKey";
import { BillingError } from "./http";

/**
 * Idempotency for client-initiated billing mutations.
 *
 * Contract:
 *   1. Client sends `Idempotency-Key: <opaque>` header (recommended UUID).
 *   2. Server hashes the canonicalized request body together with the key.
 *   3. First seen (userId, route, key) → reserves the row, runs the operation,
 *      stores the response.
 *   4. Repeat with same key + same body → returns cached response.
 *   5. Repeat with same key but different body → 409 (key reuse with different
 *      payload is a client bug).
 *   6. TTL 24h via Mongo TTL index on `expiresAt`.
 *
 * If the header is absent, the route runs without dedup — older clients keep
 * working, new clients get exactly-once semantics.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

export function hashBody(body: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");
}

export interface IdempotencyContext {
  /** null when no Idempotency-Key header was provided */
  cached: { status: number; body: unknown } | null;
  /** Call after the operation succeeds to persist the response. No-op if no key. */
  complete: (status: number, body: unknown) => Promise<void>;
  /** Call on failure to release the reservation so the client can retry. */
  fail: () => Promise<void>;
}

/**
 * Reserves an idempotency slot. Returns a cached response if the same key+body
 * was seen before, otherwise grants the caller a chance to do real work and a
 * `complete` callback to persist the outcome.
 *
 * Throws `BillingError(409)` on key reuse with a different body.
 */
export async function withIdempotency(args: {
  request: Request;
  userId: string;
  route: string;
  body: unknown;
}): Promise<IdempotencyContext> {
  const key = args.request.headers.get("Idempotency-Key")?.trim();

  if (!key) {
    return {
      cached: null,
      complete: async () => {},
      fail: async () => {},
    };
  }

  await dbConnect();
  const requestHash = hashBody(args.body);
  const expiresAt = new Date(Date.now() + TTL_MS);

  // Attempt to claim the slot. If a row already exists, inspect it.
  const existing = await IdempotencyKey.findOne({
    userId: args.userId,
    route: args.route,
    key,
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new BillingError(
        409,
        "Idempotency-Key reuse with a different request body",
        "idempotency_conflict",
      );
    }
    if (existing.status === "completed" && existing.responseStatus != null) {
      return {
        cached: {
          status: existing.responseStatus,
          body: existing.responseBody,
        },
        complete: async () => {},
        fail: async () => {},
      };
    }
    if (existing.status === "in_flight") {
      // Another request with the same key is still running. Tell the client
      // to retry shortly rather than risk a duplicate side effect.
      throw new BillingError(
        409,
        "A request with this Idempotency-Key is already in flight",
        "idempotency_in_flight",
      );
    }
    // status === "failed" → allow retry by resetting the row below.
    existing.status = "in_flight";
    existing.requestHash = requestHash;
    existing.responseStatus = null;
    existing.responseBody = null;
    existing.expiresAt = expiresAt;
    await existing.save();
  } else {
    await IdempotencyKey.create({
      userId: args.userId,
      route: args.route,
      key,
      requestHash,
      status: "in_flight",
      expiresAt,
    });
  }

  return {
    cached: null,
    complete: async (status, body) => {
      await IdempotencyKey.updateOne(
        { userId: args.userId, route: args.route, key },
        {
          $set: {
            status: "completed",
            responseStatus: status,
            responseBody: body,
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        },
      );
    },
    fail: async () => {
      await IdempotencyKey.updateOne(
        { userId: args.userId, route: args.route, key },
        { $set: { status: "failed" } },
      );
    },
  };
}

/**
 * Convenience wrapper: returns a cached NextResponse if one is available.
 */
export function cachedResponse(
  ctx: IdempotencyContext,
): NextResponse | null {
  if (!ctx.cached) return null;
  return NextResponse.json(ctx.cached.body, { status: ctx.cached.status });
}
