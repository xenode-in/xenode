/**
 * lib/cache/previewCache.ts
 *
 * Cache Storage-backed ciphertext cache for the shared file preview.
 *
 * Files larger than MAX_CACHE_BYTES are never cached (to avoid filling
 * the user's disk with large video files unintentionally).
 *
 * Expiry (24h) is stored in a custom response header `x-expires-at`.
 * Cache size is approximated via the `x-content-length` header stored on write.
 */

const CACHE_NAME = "xenode-preview-v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB — files above this are not cached

function cacheUrl(token: string) {
  return `/xenode-preview-cache/${token}`;
}

/**
 * Returns a cached Response (body = ReadableStream) or null on miss/expiry.
 * Expired entries are lazily deleted.
 */
export async function getCachedResponse(
  token: string,
): Promise<Response | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(cacheUrl(token));
    if (!res) return null;
    if (Date.now() > +(res.headers.get("x-expires-at") ?? 0)) {
      await cache.delete(cacheUrl(token));
      return null;
    }
    return res;
  } catch {
    return null;
  }
}

/**
 * Streams ciphertext into Cache Storage.
 * Skip silently if fileSizeBytes > MAX_CACHE_BYTES.
 */
export async function storeCachedStream(
  token: string,
  stream: ReadableStream<Uint8Array>,
  fileSizeBytes: number,
): Promise<void> {
  if (fileSizeBytes > MAX_CACHE_BYTES) {
    console.info(
      `[PreviewCache] Skipping cache for ${token} — file too large (${(fileSizeBytes / 1_048_576).toFixed(0)} MB > ${MAX_CACHE_BYTES / 1_048_576} MB limit)`,
    );
    return;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    const headers = new Headers({
      "x-expires-at": String(Date.now() + TTL_MS),
      "x-content-length": String(fileSizeBytes),
      "content-type": "application/octet-stream",
    });
    await cache.put(cacheUrl(token), new Response(stream, { headers }));
  } catch {
    // Non-fatal
  }
}

export interface CacheStats {
  /** Number of cached entries */
  count: number;
  /** Sum of x-content-length across all entries, in bytes */
  totalBytes: number;
}

/** Returns the number of cached entries and their approximate total size. */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let totalBytes = 0;
    const now = Date.now();
    let count = 0;

    await Promise.all(
      keys.map(async (req) => {
        const res = await cache.match(req);
        if (!res) return;
        if (now > +(res.headers.get("x-expires-at") ?? 0)) return; // expired
        totalBytes += +(res.headers.get("x-content-length") ?? 0);
        count++;
      }),
    );

    return { count, totalBytes };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}

/** Deletes ALL entries in the preview cache. */
export async function clearPreviewCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Non-fatal
  }
}

/** Removes expired entries without touching valid ones. */
export async function evictExpired(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const now = Date.now();
    await Promise.all(
      keys.map(async (req) => {
        const res = await cache.match(req);
        if (!res) return;
        if (now > +(res.headers.get("x-expires-at") ?? 0))
          await cache.delete(req);
      }),
    );
  } catch {}
}
