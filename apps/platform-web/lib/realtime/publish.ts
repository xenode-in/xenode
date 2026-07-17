import { randomUUID } from "node:crypto";
import type { ProductSlug } from "@xenode/contracts";
import {
  REALTIME_TICKET_MAX_TTL_SECONDS,
  realtimeRevokedAccessKey,
} from "@xenode/realtime";
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

export interface PublishSyncEventParams {
  userId: string;
  productId?: ProductSlug;
  spaceId: string;
  type: SyncEventType;
  payload: SyncEventPayload;
  invalidatePrefixes?: string[];
  invalidateStorage?: boolean;
  invalidateRecent?: boolean;
}

export function createSyncEvent(
  params: PublishSyncEventParams,
  eventId: string = randomUUID(),
  occurredAt = new Date(),
): SyncEventEnvelope {
  return {
    id: eventId,
    type: params.type,
    userId: params.userId,
    productId: params.productId ?? "drive",
    spaceId: params.spaceId,
    occurredAt: occurredAt.toISOString(),
    payload: params.payload,
  };
}

export async function publishSyncEvent(
  params: PublishSyncEventParams,
): Promise<void> {
  const event = createSyncEvent(params);

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
    if (event.type === "ACCESS_REVOKED") {
      pipeline.set(
        realtimeRevokedAccessKey(
          event.userId,
          event.productId,
          event.spaceId,
        ),
        "1",
        "EX",
        REALTIME_TICKET_MAX_TTL_SECONDS,
      );
    }
    pipeline.publish(REALTIME_CHANNEL, JSON.stringify(event));
    await pipeline.exec();
  });
}
