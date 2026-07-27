/**
 * Cache Storage-backed ciphertext cache for Photos thumbnails and previews.
 *
 * Plaintext never enters this cache: PhotoTile and Lightbox decrypt a cached
 * response only after retrieving the Photos ProductSpaceKey from memory.
 */

const CACHE_NAME = "xenode-photos-ciphertext-cache-v1";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 500 * 1024 * 1024;

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
  if (!Number.isFinite(byteLength) || byteLength > MAX_CACHE_BYTES) return;
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
  } catch {
    // Non-fatal: a failed cache write must not affect previewing.
  }
}

/** Fetch ciphertext from Cache Storage when available, otherwise B2. */
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
