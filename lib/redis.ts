import Redis from "ioredis";

declare global {
  var __xenodeRedis: Redis | undefined;
}

export function getRedis(): Redis {
  if (!global.__xenodeRedis) {
    global.__xenodeRedis = new Redis(
      process.env.REDIS_URL || "redis://localhost:6379",
      {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      },
    );
    global.__xenodeRedis.on("error", (error) => {
      console.warn("[redis] connection error", error.message);
    });
  }
  return global.__xenodeRedis;
}

export async function withRedis<T>(
  operation: (redis: Redis) => Promise<T>,
): Promise<T | null> {
  try {
    const redis = getRedis();
    if (redis.status === "wait") await redis.connect();
    return await operation(redis);
  } catch (error) {
    console.warn(
      "[redis] optional operation failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
