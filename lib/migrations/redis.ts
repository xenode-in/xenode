import Redis from "ioredis";

export const getRedisClient = (): Redis => {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return new Redis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
  });
};
