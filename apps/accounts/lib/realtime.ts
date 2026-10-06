import { randomUUID } from "node:crypto";
import type { ProductSlug } from "@xenode/contracts";
import {
  createProductSessionRevokedEvent,
  REALTIME_CHANNEL,
  REALTIME_TICKET_MAX_TTL_SECONDS,
  realtimeRevokedSessionKey,
} from "@xenode/realtime";
import Redis from "ioredis";

declare global {
  var __xenodeAccountsRealtimeRedis: Redis | undefined;
  var __xenodeAccountsRealtimeConnect: Promise<void> | undefined;
}

function getPublisher(): Redis {
  if (!global.__xenodeAccountsRealtimeRedis) {
    global.__xenodeAccountsRealtimeRedis = new Redis(
      process.env.REDIS_URL || "redis://localhost:6379",
      {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      },
    );
    global.__xenodeAccountsRealtimeRedis.on("error", (error) => {
      console.warn("[accounts/realtime] Redis error", error.message);
    });
  }
  return global.__xenodeAccountsRealtimeRedis;
}

/**
 * Offline queueing is off, so every caller must wait for the connection.
 * Concurrent revocations share the first caller's connect instead of failing
 * with "Stream isn't writeable" while it is still in progress.
 */
function connected(redis: Redis): Promise<void> {
  if (redis.status === "wait") global.__xenodeAccountsRealtimeConnect = redis.connect();
  return global.__xenodeAccountsRealtimeConnect ?? Promise.resolve();
}

export async function publishProductSessionRevoked(args: {
  accountId: string;
  productId: ProductSlug;
  sessionId: string;
  sessionExpiresAt: Date;
}): Promise<boolean> {
  const secondsUntilExpiry = Math.ceil(
    (args.sessionExpiresAt.getTime() - Date.now()) / 1000,
  );
  const ttl = Math.max(
    REALTIME_TICKET_MAX_TTL_SECONDS,
    Math.min(7 * 24 * 60 * 60, secondsUntilExpiry),
  );
  const event = createProductSessionRevokedEvent({
    eventId: randomUUID(),
    accountId: args.accountId,
    productId: args.productId,
    sessionId: args.sessionId,
    sessionExpiresAt: args.sessionExpiresAt,
  });

  try {
    const redis = getPublisher();
    await connected(redis);
    const result = await redis
      .multi()
      .set(realtimeRevokedSessionKey(args.sessionId), "1", "EX", ttl)
      .publish(REALTIME_CHANNEL, JSON.stringify(event))
      .exec();
    return result !== null;
  } catch (error) {
    console.warn(
      "[accounts/realtime] Session revocation publish failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
