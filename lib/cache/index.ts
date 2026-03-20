/**
 * lib/cache/index.ts
 *
 * Unified cache barrel — re-exports everything from both the preview cache
 * and the download-chunk cache, and provides aggregate helpers.
 */

// ── Preview Cache ───────────────────────────────────────────────────────────
export {
  getCachedResponse,
  storeCachedStream,
  clearPreviewCache,
  evictExpired,
  MAX_CACHE_BYTES,
} from "./previewCache";

export {
  getCacheStats as getPreviewCacheStats,
  type CacheStats as PreviewCacheStats,
} from "./previewCache";

// ── Download-Chunk Cache ────────────────────────────────────────────────────
export {
  DL_CACHE_NAME,
  getCachedIds,
  getCachedSize,
  getCachedBytes,
  appendChunk,
  clearCache,
  truncateCache,
  getNextChunkIndex,
  evictStaleChunks,
  getChunkCacheStats,
  type ChunkCacheStats,
} from "@/lib/downloadCache";

// ── Aggregate helpers ───────────────────────────────────────────────────────

import { getCacheStats as _getPreviewStats } from "./previewCache";
import {
  evictStaleChunks,
  getChunkCacheStats,
  DL_CACHE_NAME,
} from "@/lib/downloadCache";
import { clearPreviewCache } from "./previewCache";

export interface CacheStats {
  /** Total cached entries across both caches */
  count: number;
  /** Approximate total bytes across both caches */
  totalBytes: number;
}

/**
 * Returns aggregate stats across both the preview cache and the
 * download-chunk cache. Lazily evicts stale chunks (>7 days) first.
 */
export async function getCacheStats(): Promise<CacheStats> {
  // Lazy eviction — clean up orphaned chunks whenever stats are requested
  await evictStaleChunks();

  const [preview, chunks] = await Promise.all([
    _getPreviewStats(),
    getChunkCacheStats(),
  ]);

  return {
    count: preview.count + chunks.count,
    totalBytes: preview.totalBytes + chunks.totalBytes,
  };
}

/** Clears both the preview cache and the download-chunk cache entirely. */
export async function clearAllCaches(): Promise<void> {
  await Promise.all([
    clearPreviewCache(),
    caches.delete(DL_CACHE_NAME),
  ]);
}
