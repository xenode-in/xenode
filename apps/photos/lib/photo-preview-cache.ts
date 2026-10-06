/**
 * Cache Storage-backed ciphertext cache for Photos thumbnails and previews.
 *
 * Plaintext never enters this cache: PhotoTile and Lightbox decrypt a cached
 * response only after retrieving the Photos ProductSpaceKey from memory.
 */

const CACHE_NAME = "xenode-photos-ciphertext-cache-v1";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
// Prune after this many new bytes (and on a tab's first write).
const PRUNE_AFTER_BYTES = 16 * 1024 * 1024;
let writtenSincePrune = PRUNE_AFTER_BYTES;
let pruning: Promise<void> | null = null;

function cacheUrl(key: string) {
  return `/_xenode-photos-cache/${encodeURIComponent(key)}`;
}

export function photoPreviewCacheKey({
  accountId,
  objectKey,
  spaceId,
  variant,
}: {
  accountId: string;
  objectKey: string;
  spaceId: string;
  variant: string;
}) {
  return `${accountId}:${spaceId}:${objectKey}:${variant}`;
}

async function getCachedResponse(key: string): Promise<Response | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(cacheUrl(key));
    if (!response) return null;
    if (Date.now() <= Number(response.headers.get("x-expires-at"))) {
      return response;
    }
    await cache.delete(cacheUrl(key));
  } catch {
    // Cache Storage is optional; network fetches remain the fallback.
  }
  return null;
}

async function storeCiphertext(
  key: string,
  stream: ReadableStream<Uint8Array>,
  byteLength: number,
) {
  if (!Number.isFinite(byteLength) || byteLength > MAX_ENTRY_BYTES) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      cacheUrl(key),
      new Response(stream, {
        headers: {
          "content-type": "application/octet-stream",
          "x-content-length": String(byteLength),
          "x-expires-at": String(Date.now() + TTL_MS),
        },
      }),
    );
    writtenSincePrune += byteLength;
    if (writtenSincePrune >= PRUNE_AFTER_BYTES) void prunePhotoCiphertextCache();
  } catch {
    // Non-fatal: a failed cache write must not affect previewing.
  }
}

/**
 * Drop expired entries, then the oldest until the cache fits its budget.
 * ponytail: oldest-written first (reads do not refresh); LRU if hit rate matters.
 */
export function prunePhotoCiphertextCache(
  maxBytes = MAX_CACHE_BYTES,
  now = Date.now(),
) {
  writtenSincePrune = 0;
  pruning ??= (async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const entries: { request: Request; expiresAt: number; bytes: number }[] = [];
      for (const request of await cache.keys()) {
        const headers = (await cache.match(request))?.headers;
        const expiresAt = Number(headers?.get("x-expires-at"));
        const bytes = Number(headers?.get("x-content-length"));
        if (expiresAt > now && Number.isSafeInteger(bytes) && bytes >= 0) {
          entries.push({ request, expiresAt, bytes });
        } else {
          await cache.delete(request);
        }
      }
      entries.sort((a, b) => a.expiresAt - b.expiresAt);
      let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      for (const entry of entries) {
        if (total <= maxBytes) break;
        await cache.delete(entry.request);
        total -= entry.bytes;
      }
    } catch {
      // Cache Storage is optional.
    } finally {
      pruning = null;
    }
  })();
  return pruning;
}

/** Fetch ciphertext from Cache Storage when available, otherwise R2. */
export async function fetchCachedPhotoCiphertext(
  url: string,
  cacheKey: string,
): Promise<ArrayBuffer> {
  const cached = await getCachedResponse(cacheKey);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not read photo");

  const contentLength = response.headers.get("content-length");
  const byteLength = contentLength ? Number(contentLength) : Number.NaN;
  if (!response.body || !Number.isFinite(byteLength)) {
    return response.arrayBuffer();
  }

  const [forCache, forRead] = response.body.tee();
  void storeCiphertext(cacheKey, forCache, byteLength);
  return new Response(forRead).arrayBuffer();
}
