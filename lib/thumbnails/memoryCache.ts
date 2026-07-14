const MAX_THUMBNAILS = 500;

interface CachedThumbnail {
  blob: Blob;
  lastAccessed: number;
}

const cache = new Map<string, CachedThumbnail>();
const clearListeners = new Set<() => void>();
let generation = 0;

export function getThumbnailCacheGeneration(): number {
  return generation;
}

export function getCachedThumbnail(key: string): Blob | null {
  const hit = cache.get(key);
  if (!hit) return null;
  hit.lastAccessed = Date.now();
  return hit.blob;
}

export function putCachedThumbnail(
  key: string,
  blob: Blob,
  expectedGeneration: number,
): boolean {
  if (expectedGeneration !== generation) return false;

  if (!cache.has(key) && cache.size >= MAX_THUMBNAILS) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [candidateKey, value] of cache) {
      if (value.lastAccessed < oldest) {
        oldest = value.lastAccessed;
        oldestKey = candidateKey;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, { blob, lastAccessed: Date.now() });
  return true;
}

/**
 * Wipes decrypted thumbnail bytes and tells mounted hooks to revoke their
 * object URLs. The generation prevents an in-flight download from repopulating
 * the cache after a vault lock or logout.
 */
export function clearThumbnailMemoryCache(): void {
  generation += 1;
  cache.clear();
  for (const listener of clearListeners) {
    try {
      listener();
    } catch {
      // A stale component must not prevent other object URLs from being revoked.
    }
  }
}

export function onThumbnailMemoryCacheCleared(listener: () => void): () => void {
  clearListeners.add(listener);
  return () => clearListeners.delete(listener);
}

export const __thumbnailMemoryCacheTestUtils =
  process.env.NODE_ENV === "test"
    ? {
        size: () => cache.size,
      }
    : undefined;
