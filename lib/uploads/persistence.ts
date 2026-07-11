import { getDb, type UploadRecord } from "@/lib/db/local";

/**
 * Client-side persistence for resumable uploads. Thin wrappers over the Dexie
 * `uploads` table (per-user DB). All calls are best-effort — a persistence
 * failure must never abort the actual upload, so callers catch/ignore.
 */

export async function saveUploadRecord(
  userId: string,
  record: UploadRecord,
): Promise<void> {
  await getDb(userId).uploads.put(record);
}

export async function patchUploadRecord(
  userId: string,
  id: string,
  patch: Partial<UploadRecord>,
): Promise<void> {
  await getDb(userId).uploads.update(id, patch);
}

/** Mark a chunk index complete (idempotent) and persist the growing set. */
export async function markChunkComplete(
  userId: string,
  id: string,
  index: number,
): Promise<void> {
  const db = getDb(userId);
  const rec = await db.uploads.get(id);
  if (!rec) return;
  if (!rec.completedChunks.includes(index)) {
    rec.completedChunks = [...rec.completedChunks, index].sort((a, b) => a - b);
    await db.uploads.put(rec);
  }
}

export async function getUploadRecord(
  userId: string,
  id: string,
): Promise<UploadRecord | undefined> {
  return getDb(userId).uploads.get(id);
}

/** All journaled uploads for this user, oldest first — used to rehydrate on load. */
export async function listUploadRecords(
  userId: string,
): Promise<UploadRecord[]> {
  return getDb(userId).uploads.orderBy("createdAt").toArray();
}

export async function deleteUploadRecord(
  userId: string,
  id: string,
): Promise<void> {
  await getDb(userId).uploads.delete(id);
}

/**
 * Ask the browser to keep our IndexedDB from being evicted under storage
 * pressure (important on iOS where uploads-in-progress could otherwise be
 * purged). Safe to call repeatedly; no-op where unsupported.
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage?.persist &&
      navigator.storage.persisted
    ) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {
    /* best-effort */
  }
}
