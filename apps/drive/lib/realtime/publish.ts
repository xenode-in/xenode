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
import { folderListingId } from "@/lib/storage/folders";

export function toSyncObjectSnapshot(value: unknown): SyncObjectSnapshot {
  return JSON.parse(JSON.stringify(value)) as SyncObjectSnapshot;
}

export interface PublishSyncEventParams {
  userId: string;
  productId?: ProductSlug;
  spaceId: string;
  type: SyncEventType;
  payload: SyncEventPayload;
  /** Folder listings to invalidate: folder ids, or null for the Space root. */
  invalidateFolders?: Array<string | { toString(): string } | null | undefined>;
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
    for (const folderId of new Set(
      (params.invalidateFolders ?? []).map(folderListingId),
    )) {
      pipeline.incr(folderVersionKey(params.spaceId, folderId));
    }
    if (params.invalidateStorage) {
      pipeline.del(storageCacheKey(params.spaceId));
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
