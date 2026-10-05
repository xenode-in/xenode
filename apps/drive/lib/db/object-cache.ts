import { getDb, LocalFile } from "@/lib/db/local";

export type ServerObject = {
  _id?: string;
  id?: string;
  key: string;
  spaceId?: string;
  syncVersion?: number;
  position?: number;
  starred?: boolean;
  folderId?: string | null;
  ancestorIds?: string[];
  size?: number;
  contentType?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  isEncrypted?: boolean;
  wrappedBy?: "user" | "space" | null;
  spaceKeyVersion?: number | null;
  spaceKeyWrapIv?: string | null;
  encryptedName?: string | null;
  encryptedDisplayName?: string | null;
  encryptedContentType?: string | null;
  tags?: string[];
  thumbnail?: string;
  bucketId?: string | { _id?: string; toString?: () => string };
  mediaCategory?: string;
  optimizedKey?: string;
  optimizedEncryptedDEK?: string;
  optimizedSpaceKeyWrapIv?: string;
  optimizedIV?: string;
  optimizedSize?: number;
  aspectRatio?: number;
  uploadSource?: "web" | "mobile_manual" | "mobile_backup" | "migration";
  syncContentFp?: string;
};

function toIso(value: ServerObject["createdAt"], fallback = new Date()): string {
  if (!value) return fallback.toISOString();
  return new Date(value).toISOString();
}

function normalizeBucketId(bucketId: ServerObject["bucketId"], fallback: string) {
  if (!bucketId) return fallback;
  if (typeof bucketId === "string") return bucketId;
  if (bucketId._id) return String(bucketId._id);
  return bucketId.toString?.() || fallback;
}

export function mapServerObjectToLocalFile(
  object: ServerObject,
  fallbackBucketId: string,
): LocalFile {
  const now = new Date();
  return {
    id: String(object._id || object.id),
    syncVersion: object.syncVersion ?? 0,
    position: object.position,
    starred: object.starred,
    key: object.key,
    spaceId: object.spaceId,
    folderId: object.folderId ? String(object.folderId) : null,
    ancestorIds: (object.ancestorIds ?? []).map(String),
    encryptedName: object.encryptedName || object.encryptedDisplayName || null,
    name: "Encrypted File",
    size: object.size || 0,
    contentType: object.contentType || "application/octet-stream",
    createdAt: toIso(object.createdAt, now),
    updatedAt: toIso(object.updatedAt, now),
    isEncrypted: object.isEncrypted || false,
    wrappedBy: object.wrappedBy || undefined,
    spaceKeyVersion: object.spaceKeyVersion || undefined,
    spaceKeyWrapIv: object.spaceKeyWrapIv || undefined,
    tags: object.tags || [],
    thumbnail: object.thumbnail,
    bucketId: normalizeBucketId(object.bucketId, fallbackBucketId),
    encryptedContentType: object.encryptedContentType || undefined,
    encryptedDisplayName: object.encryptedDisplayName || undefined,
    mediaCategory: object.mediaCategory,
    optimizedKey: object.optimizedKey,
    optimizedEncryptedDEK: object.optimizedEncryptedDEK,
    optimizedSpaceKeyWrapIv: object.optimizedSpaceKeyWrapIv,
    optimizedIV: object.optimizedIV,
    optimizedSize: object.optimizedSize,
    aspectRatio: object.aspectRatio,
    uploadSource: object.uploadSource,
    syncContentFp: object.syncContentFp,
  };
}

export async function upsertLocalObject(
  userId: string | null | undefined,
  object: ServerObject | null | undefined,
  bucketId: string | null | undefined,
) {
  if (
    !userId ||
    !object ||
    !bucketId ||
    !object.key ||
    !(object._id || object.id)
  ) {
    return;
  }
  await upsertLocalObjects(userId, [object], bucketId);
}

export async function upsertLocalObjects(
  userId: string | null | undefined,
  objects: ServerObject[] | null | undefined,
  bucketId: string | null | undefined,
) {
  if (!userId || !objects?.length || !bucketId) return;
  const db = getDb(userId);
  await db.transaction("rw", db.files, db.syncRemovals, async () => {
    for (const object of objects) {
      if (!object.key || !(object._id || object.id) || !object.spaceId) continue;
      const row = mapServerObjectToLocalFile(object, bucketId);
      if (!Number.isSafeInteger(row.syncVersion) || row.syncVersion < 0) continue;
      const previous = await db.files.get(row.id);
      const removed = await db.syncRemovals.get([object.spaceId, row.id]);
      if ((previous && previous.syncVersion > row.syncVersion) || (removed && removed.syncVersion >= row.syncVersion)) continue;
      await db.files.put(row);
      if (removed) await db.syncRemovals.delete([object.spaceId, row.id]);
    }
  });
}

export async function deleteLocalObjects(
  userId: string | null | undefined,
  ids: string[],
) {
  if (!userId || ids.length === 0) return;
  const db = getDb(userId);
  await db.transaction("rw", db.files, db.syncRemovals, async () => {
    for (const id of ids) {
      const row = await db.files.get(id);
      if (row?.spaceId) await db.syncRemovals.put({ id, spaceId: row.spaceId, syncVersion: row.syncVersion });
      await db.files.delete(id);
    }
  });
}

/** Remove a folder and every cached descendant (they leave together). */
export async function deleteLocalSubtree(
  userId: string | null | undefined,
  folderId: string,
) {
  if (!userId || !folderId) return;
  const db = getDb(userId);
  const descendants = await db.files
    .where("ancestorIds")
    .equals(folderId)
    .primaryKeys();
  await deleteLocalObjects(userId, [folderId, ...(descendants as string[])]);
}
