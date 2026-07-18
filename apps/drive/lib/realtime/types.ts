import type { ProductSlug } from "@xenode/contracts";
export { REALTIME_CHANNEL } from "@xenode/realtime";

export const REALTIME_SOCKET_EVENT = "sync:event";

export const syncEventTypes = [
  "FILE_CREATED",
  "FILE_UPDATED",
  "FILE_DELETED",
  "FOLDER_CREATED",
  "FOLDER_UPDATED",
  "FOLDER_DELETED",
  "FILE_MOVED",
  "FILE_STARRED",
  "FILE_UNSTARRED",
  "PHOTO_SYNC_COMPLETED",
  "TRASH_UPDATED",
  "STORAGE_UPDATED",
  "SYNC_REQUIRED",
  "ACCESS_REVOKED",
] as const;

export type SyncEventType = (typeof syncEventTypes)[number];

export interface SyncObjectSnapshot {
  _id: string;
  bucketId: string;
  key: string;
  size: number;
  contentType: string;
  encryptedContentType?: string | null;
  thumbnail?: string | null;
  thumbnailUrl?: string | null;
  optimizedUrl?: string | null;
  tags?: string[];
  position?: number;
  starred?: boolean;
  lastAccessedAt?: string | Date | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  isEncrypted?: boolean;
  encryptedName?: string | null;
  encryptedDisplayName?: string | null;
  mediaCategory?: string | null;
  optimizedKey?: string | null;
  optimizedEncryptedDEK?: string | null;
  optimizedIV?: string | null;
  optimizedSize?: number | null;
  aspectRatio?: number | null;
}

export interface SyncEventPayload {
  bucketId?: string;
  objectId?: string;
  objectIds?: string[];
  key?: string;
  keys?: string[];
  parentPrefix?: string;
  affectedPrefixes?: string[];
  destinationPrefix?: string;
  object?: SyncObjectSnapshot;
  objects?: SyncObjectSnapshot[];
  storageBytes?: number;
  reason?: string;
}

export interface SyncEventEnvelope {
  id: string;
  type: SyncEventType;
  userId: string;
  productId: ProductSlug;
  spaceId: string;
  occurredAt: string;
  payload: SyncEventPayload;
}
