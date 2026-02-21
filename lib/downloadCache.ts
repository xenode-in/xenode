/**
 * lib/downloadCache.ts
 *
 * IndexedDB-backed chunk cache for resumable encrypted downloads.
 *
 * Each in-flight download stores its ciphertext bytes here as they arrive.
 * On restart the cached bytes are re-used so the Range request only fetches
 * the missing tail — exactly what MEGA does client-side.
 *
 * Store layout:
 *   DB  : "xenode-dl-cache"  (version 1)
 *   Store: "chunks"  key = objectId (string)  value = Blob
 */

const DB_NAME = "xenode-dl-cache";
const STORE_NAME = "chunks";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Returns all object IDs that have cached bytes (i.e. interrupted downloads). */
export async function getCachedIds(): Promise<string[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Returns the number of bytes already cached for this object, or 0. */
export async function getCachedSize(objectId: string): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(objectId);
      req.onsuccess = () => {
        const blob: Blob | undefined = req.result;
        resolve(blob ? blob.size : 0);
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/** Reads all cached bytes for this object as a Uint8Array, or null if none. */
export async function getCachedBytes(
  objectId: string,
): Promise<Uint8Array | null> {
  try {
    const db = await openDB();
    const blob: Blob | undefined = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(objectId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    if (!blob || blob.size === 0) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Appends a single chunk to the existing cached blob (or creates a new one). */
export async function appendChunk(
  objectId: string,
  chunk: Uint8Array,
): Promise<void> {
  try {
    const db = await openDB();
    // Read existing blob first then write the merged blob back
    const existing: Blob | undefined = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(objectId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });

    // Cast to Uint8Array<ArrayBuffer> to satisfy the BlobPart type constraint
    const chunkPart =
      chunk.buffer instanceof ArrayBuffer
        ? new Uint8Array(chunk.buffer as ArrayBuffer)
        : new Uint8Array(chunk);
    const parts: BlobPart[] = existing ? [existing, chunkPart] : [chunkPart];
    const merged = new Blob(parts, { type: "application/octet-stream" });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(merged, objectId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Non-critical: if IndexedDB fails we still download, just can't resume
  }
}

/** Removes the cached bytes after a successful download. */
export async function clearCache(objectId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(objectId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore cleanup errors
  }
}
