import { getDb, LocalFile } from "@/lib/db/local";

export type ServerObject = {
  _id?: string;
  id?: string;
  key: string;
  size?: number;
  contentType?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  isEncrypted?: boolean;
  encryptedName?: string | null;
  encryptedDisplayName?: string | null;
  encryptedContentType?: string | null;
  tags?: string[];
  thumbnail?: string;
  bucketId?: string | { _id?: string; toString?: () => string };
  mediaCategory?: string;
  optimizedKey?: string;
  optimizedEncryptedDEK?: string;
  optimizedIV?: string;
  optimizedSize?: number;
  aspectRatio?: number;
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
    key: object.key,
    encryptedName: object.encryptedName || object.encryptedDisplayName || null,
    name: object.key.split("/").filter(Boolean).pop() || object.key,
    size: object.size || 0,
    contentType: object.contentType || "application/octet-stream",
    createdAt: toIso(object.createdAt, now),
    updatedAt: toIso(object.updatedAt, now),
    isEncrypted: object.isEncrypted || false,
    tags: object.tags || [],
    thumbnail: object.thumbnail,
    bucketId: normalizeBucketId(object.bucketId, fallbackBucketId),
    encryptedContentType: object.encryptedContentType || undefined,
    encryptedDisplayName: object.encryptedDisplayName || undefined,
    mediaCategory: object.mediaCategory,
    optimizedKey: object.optimizedKey,
    optimizedEncryptedDEK: object.optimizedEncryptedDEK,
    optimizedIV: object.optimizedIV,
    optimizedSize: object.optimizedSize,
    aspectRatio: object.aspectRatio,
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
  await getDb(userId).files.put(mapServerObjectToLocalFile(object, bucketId));
}

export async function upsertLocalObjects(
  userId: string | null | undefined,
  objects: ServerObject[] | null | undefined,
  bucketId: string | null | undefined,
) {
  if (!userId || !objects?.length || !bucketId) return;
  await getDb(userId).files.bulkPut(
    objects
      .filter((object) => object.key && (object._id || object.id))
      .map((object) => mapServerObjectToLocalFile(object, bucketId)),
  );
}

export async function deleteLocalObjects(
  userId: string | null | undefined,
  ids: string[],
) {
  if (!userId || ids.length === 0) return;
  await getDb(userId).files.bulkDelete(ids);
}

export async function deleteLocalPrefix(
  userId: string | null | undefined,
  bucketId: string | null | undefined,
  prefix: string,
) {
  if (!userId || !bucketId || !prefix) return;
  const db = getDb(userId);
  const rows = await db.files
    .where("bucketId")
    .equals(bucketId)
    .filter((file) => file.key.startsWith(prefix))
    .primaryKeys();
  if (rows.length > 0) await db.files.bulkDelete(rows as string[]);
}
