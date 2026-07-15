import { randomUUID } from "node:crypto";
import {
  folderVersionKey,
  recentCacheKey,
  storageCacheKey,
} from "@/lib/realtime/cache-keys";
import {
  REALTIME_CHANNEL,
  type SyncEventEnvelope,
  type SyncObjectSnapshot,
  type SyncEventPayload,
  type SyncEventType,
} from "@/lib/realtime/types";
import { withRedis } from "@/lib/redis";

export function parentPrefixForKey(key: string): string {
  const normalized = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash + 1);
}

export function toSyncObjectSnapshot(value: unknown): SyncObjectSnapshot {
  return JSON.parse(JSON.stringify(value)) as SyncObjectSnapshot;
}

export async function publishSyncEvent(params: {
  userId: string;
  spaceId: string;
  type: SyncEventType;
  payload: SyncEventPayload;
  invalidatePrefixes?: string[];
  invalidateStorage?: boolean;
  invalidateRecent?: boolean;
}): Promise<void> {
  const event: SyncEventEnvelope = {
    id: randomUUID(),
    type: params.type,
    userId: params.userId,
    productId: "drive",
    spaceId: params.spaceId,
    occurredAt: new Date().toISOString(),
    payload: params.payload,
  };

  await withRedis(async (redis) => {
    const pipeline = redis.multi();
    for (const prefix of new Set(params.invalidatePrefixes ?? [])) {
      if (params.payload.bucketId) {
        pipeline.incr(
          folderVersionKey(
            params.userId,
            params.payload.bucketId,
            prefix,
          ),
        );
      }
    }
    if (params.invalidateStorage) {
      pipeline.del(storageCacheKey(params.userId));
    }
    if (params.invalidateRecent) {
      pipeline.del(recentCacheKey(params.userId));
    }
    pipeline.publish(REALTIME_CHANNEL, JSON.stringify(event));
    await pipeline.exec();
  });
}
