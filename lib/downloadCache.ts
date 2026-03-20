/**
 * lib/downloadCache.ts
 *
 * Cache API-backed chunk cache for resumable encrypted downloads.
 *
 * Each in-flight download stores its ciphertext bytes here as they arrive.
 * On restart the cached bytes are re-used so the Range request only fetches
 * the missing tail — exactly what MEGA does client-side.
 *
 * Store layout:
 *   CacheStorage : "xenode-dl-chunks-v1"
 *   Entry: request URL = `/cache/chunks/${objectId}/${index}`, response = Blob
 */

export const DL_CACHE_NAME = "xenode-dl-chunks-v1";
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Returns all object IDs that have cached bytes (i.e. interrupted downloads). */
export async function getCachedIds(): Promise<string[]> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();
    const ids = new Set<string>();
    
    for (const req of requests) {
      const url = new URL(req.url);
      const parts = url.pathname.split("/");
      // Expected path: /cache/chunks/{objectId}/{index}
      if (parts.length >= 4 && parts[1] === "cache" && parts[2] === "chunks") {
        ids.add(parts[3]);
      }
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

/** Returns the number of bytes already cached for this object, or 0. */
export async function getCachedSize(objectId: string): Promise<number> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();
    let totalSize = 0;

    for (const req of requests) {
      const url = new URL(req.url);
      if (url.pathname.startsWith(`/cache/chunks/${objectId}/`)) {
        const res = await cache.match(req);
        if (res) {
            const sizeStr = res.headers.get("Content-Length");
            if (sizeStr) {
                totalSize += parseInt(sizeStr, 10);
            } else {
                // Fallback to reading blob size if header is missing
                const blob = await res.blob();
                totalSize += blob.size;
            }
        }
      }
    }
    return totalSize;
  } catch {
    return 0;
  }
}

/** Reads all cached bytes for this object as a Uint8Array, or null if none. */
export async function getCachedBytes(
  objectId: string,
): Promise<Uint8Array | null> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();
    
    // Find all chunks for this objectId and parse their indices
    const chunkRequests = requests
      .filter(req => new URL(req.url).pathname.startsWith(`/cache/chunks/${objectId}/`))
      .map(req => {
        const url = new URL(req.url);
        const parts = url.pathname.split("/");
        const index = parseInt(parts[parts.length - 1], 10);
        return { req, index };
      })
      .sort((a, b) => a.index - b.index);

    if (chunkRequests.length === 0) return null;

    let totalLength = 0;
    const buffers: Uint8Array[] = [];

    // Read all responses
    for (const { req } of chunkRequests) {
      const res = await cache.match(req);
      if (res) {
        const arrayBuffer = await res.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        buffers.push(uint8Array);
        totalLength += uint8Array.length;
      }
    }

    if (totalLength === 0) return null;

    // Concatenate all chunks into a single Uint8Array
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    return combined;
  } catch {
    return null;
  }
}

/** Appends a single chunk to the cache. */
export async function appendChunk(
  objectId: string,
  chunk: Uint8Array,
  index: number
): Promise<void> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    
    // Create a synthetic response
    const arrayBuffer = new Uint8Array(chunk).buffer;
    const response = new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": chunk.length.toString(),
        "x-cached-at": String(Date.now()),
      }
    });

    // Store in cache using a unique URL per chunk
    const url = `/cache/chunks/${objectId}/${index}`;
    await cache.put(url, response);
  } catch {
    // Non-critical: if cache fails we still download, just can't resume
  }
}

/** Removes all cached chunks after a successful download. */
export async function clearCache(objectId: string): Promise<void> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();

    for (const req of requests) {
      const url = new URL(req.url);
      if (url.pathname.startsWith(`/cache/chunks/${objectId}/`)) {
        await cache.delete(req);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/** 
 * Truncates the cached bytes. 
 * Note: With the new Cache API strategy, we don't truncate blobs mid-chunk.
 * We rely on deleting specific chunk indices if needed, or simply not
 * fetching them. This is kept for compatibility with DownloadContext.tsx
 * if we want to delete everything from a specific chunk index onwards.
 */
export async function truncateCache(
  objectId: string,
  fromIndex: number,
): Promise<void> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();

    for (const req of requests) {
      const url = new URL(req.url);
      const parts = url.pathname.split("/");
      if (parts.length >= 4 && parts[1] === "cache" && parts[2] === "chunks" && parts[3] === objectId) {
        const idx = parseInt(parts[4], 10);
        if (idx >= fromIndex) {
          await cache.delete(req);
        }
      }
    }
  } catch {
    //
  }
}

export async function getNextChunkIndex(objectId: string): Promise<number> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();
    let maxIndex = -1;
    for (const req of requests) {
      const url = new URL(req.url);
      const parts = url.pathname.split("/");
      if (parts.length >= 4 && parts[1] === "cache" && parts[2] === "chunks" && parts[3] === objectId) {
        const idx = parseInt(parts[4], 10);
        if (idx > maxIndex) maxIndex = idx;
      }
    }
    return maxIndex + 1;
  } catch {
    return 0;
  }
}

/** Deletes any chunk entries older than 7 days. */
export async function evictStaleChunks(): Promise<void> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();
    const now = Date.now();

    await Promise.all(
      requests.map(async (req) => {
        const res = await cache.match(req);
        if (!res) return;
        const cachedAt = +(res.headers.get("x-cached-at") ?? 0);
        // Entries without the header (legacy) are treated as stale
        if (cachedAt === 0 || now - cachedAt > STALE_TTL_MS) {
          await cache.delete(req);
        }
      }),
    );
  } catch {
    // Non-fatal
  }
}

export interface ChunkCacheStats {
  /** Number of cached chunk entries */
  count: number;
  /** Sum of Content-Length across all chunk entries, in bytes */
  totalBytes: number;
}

/** Returns the number of cached chunks and their approximate total size. */
export async function getChunkCacheStats(): Promise<ChunkCacheStats> {
  try {
    const cache = await caches.open(DL_CACHE_NAME);
    const requests = await cache.keys();
    let totalBytes = 0;
    let count = 0;

    await Promise.all(
      requests.map(async (req) => {
        const res = await cache.match(req);
        if (!res) return;
        const len = +(res.headers.get("Content-Length") ?? 0);
        totalBytes += len;
        count++;
      }),
    );

    return { count, totalBytes };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
