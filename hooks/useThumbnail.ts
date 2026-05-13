/**
 * useThumbnail — fetches, decrypts, and blob-URL-caches a single thumbnail.
 *
 * Architecture (two stages):
 *
 *   Stage 1 — URL batch (50 ms coalesce):
 *     All useThumbnail calls within 50ms are coalesced into one
 *     POST /api/objects/thumbnail/batch request. The server does pure HMAC
 *     signing (~5ms, no B2 I/O) and returns { urls: { key: proxyUrl } }.
 *     The proxy URL routes through /api/files/ which has CDN caching.
 *
 *   Stage 2 — Controlled download (max 5 concurrent):
 *     Each signed proxy URL is downloaded via fetch() with a semaphore
 *     capping concurrent requests at MAX_CONCURRENT_DOWNLOADS=5.
 *     The browser streams bytes from /api/files/ → B2 (keepalive reused).
 *     Unlimited concurrency (Promise.all(50)) caused network congestion
 *     and 8s load times; 5-at-a-time completes in ~1-2s.
 *
 * Full flow per thumbnail:
 *   1. Check Dexie LRU cache — if hit, return blob URL immediately.
 *   2. Queue the B2 key for URL batch (50 ms coalesce window).
 *   3. Batch fires → server returns HMAC proxy URLs for all queued keys.
 *   4. Acquire semaphore slot (max 5 concurrent).
 *   5. GET the proxy URL → /api/files/ validates HMAC → streams from B2.
 *   6. If `enc:` prefix detected, decrypt with the provided CryptoKey.
 *   7. Store resulting Blob in Dexie (with LRU eviction at MAX_THUMBNAILS).
 *   8. Release semaphore slot; return blob URL via setState → re-render.
 *
 * CDN note: /api/files/ sets Cache-Control: public, max-age=3600 and the
 * HMAC URL is time-windowed (same URL for entire 1h block), so CDN edge
 * nodes cache the bytes — subsequent loads cost ~0ms.
 */

import { useState, useEffect } from "react";
import { getDb } from "@/lib/db/local";
import { useSession } from "@/lib/auth/client";

const MAX_THUMBNAILS = 500;
const COALESCE_MS = 50;
const MAX_BATCH_KEYS = 50;
const MAX_CONCURRENT_DOWNLOADS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level concurrency semaphore
//
// Limits simultaneous GET /api/files/ requests so the server is not flooded
// with 50 connections at once. Queue is FIFO; slots released in finally blocks.
// ─────────────────────────────────────────────────────────────────────────────

let _activeDownloads = 0;
// Queue stores plain `resolve` callbacks — NOT lambdas that increment the
// counter. releaseSlot "transfers" the active slot to the next waiter, so
// _activeDownloads stays constant while the queue drains. Only decrements
// when the queue is empty (slot truly freed). This prevents the bug where
// each queue-flush increments the counter, making it exceed MAX and
// deadlocking all future downloads.
const _downloadQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (_activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      _activeDownloads++; // slot acquired immediately
      resolve();
    } else {
      _downloadQueue.push(resolve); // wait; slot transferred by releaseSlot
    }
  });
}

function releaseSlot(): void {
  const next = _downloadQueue.shift();
  if (next) {
    // Transfer slot to the next waiter — _activeDownloads stays the same.
    next();
  } else {
    // No waiters; slot is truly freed.
    _activeDownloads--;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level URL batcher
//
// Shared across all useThumbnail instances so photos mounting in the same
// frame fold into a single POST /api/objects/thumbnail/batch request.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolver/rejecter pair for a pending key. */
interface PendingResolver {
  resolve: (url: string) => void;
  reject: (reason: unknown) => void;
}

/** Keys awaiting the next flush, mapped to their promise callbacks. */
const _pendingResolvers = new Map<string, PendingResolver[]>();

/**
 * In-flight dedup map: once a key has been queued its Promise is stored here
 * so a second call for the same key within the coalesce window returns the
 * same Promise instead of enqueuing a duplicate.
 * Entries are removed when the promise settles (so retries work after failure).
 */
const _inFlightPromises = new Map<string, Promise<string>>();

let _flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushBatch() {
  _flushTimer = null;

  // Drain the pending map atomically.
  const snapshot = new Map(_pendingResolvers);
  _pendingResolvers.clear();

  if (snapshot.size === 0) return;

  const keys = Array.from(snapshot.keys());

  for (let i = 0; i < keys.length; i += MAX_BATCH_KEYS) {
    const chunk = keys.slice(i, i + MAX_BATCH_KEYS);

    try {
      const res = await fetch("/api/objects/thumbnail/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: chunk }),
      });

      if (!res.ok) throw new Error(`thumbnail/batch HTTP ${res.status}`);

      const { urls } = (await res.json()) as { urls: Record<string, string> };

      for (const key of chunk) {
        const url = urls[key];
        const resolvers = snapshot.get(key) ?? [];
        if (url) {
          resolvers.forEach((r) => r.resolve(url));
        } else {
          resolvers.forEach((r) =>
            r.reject(new Error(`No signed URL returned for thumbnail key`)),
          );
        }
        _inFlightPromises.delete(key);
      }
    } catch (err) {
      for (const key of chunk) {
        snapshot.get(key)?.forEach((r) => r.reject(err));
        _inFlightPromises.delete(key);
      }
    }
  }
}

/**
 * Queue `key` for URL batch. Returns a Promise that resolves to the signed
 * proxy URL once the batch fires. Deduped within the coalesce window.
 */
function requestUrl(key: string): Promise<string> {
  if (_inFlightPromises.has(key)) return _inFlightPromises.get(key)!;

  const promise = new Promise<string>((resolve, reject) => {
    if (!_pendingResolvers.has(key)) _pendingResolvers.set(key, []);
    _pendingResolvers.get(key)!.push({ resolve, reject });
  });

  _inFlightPromises.set(key, promise);

  if (!_flushTimer) {
    _flushTimer = setTimeout(flushBatch, COALESCE_MS);
  }

  return promise;
}

function resetThumbnailBatcherForTests() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  _pendingResolvers.clear();
  _inFlightPromises.clear();
  _downloadQueue.length = 0;
  _activeDownloads = 0;
}

export const __thumbnailBatchTestUtils =
  process.env.NODE_ENV === "test"
    ? {
        flushBatch,
        requestUrl,
        resetThumbnailBatcherForTests,
      }
    : undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches, decrypts, and returns a blob URL for a thumbnail B2 key.
 *
 * @param thumbnail  B2 key string, base64 data URI, or undefined.
 * @param decryptionKey  CryptoKey used to decrypt `enc:` thumbnails (optional).
 */
export function useThumbnail(
  thumbnail: string | undefined,
  decryptionKey: CryptoKey | null = null,
) {
  const [url, setUrl] = useState<string | null>(null);
  const { data: session } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!thumbnail) {
      setUrl(null);
      return;
    }

    // Legacy base64 thumbnails — serve immediately, no fetch needed.
    if (thumbnail.startsWith("data:")) {
      setUrl(thumbnail);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    // AbortController cancels the in-flight GET /api/files/ fetch when the
    // tile unmounts or thumbnail prop changes before the download completes.
    const abortCtrl = new AbortController();

    async function loadThumbnail() {
      if (!userId) return; // wait for session

      const db = getDb(userId);

      try {
        // ── 1. Dexie LRU cache ───────────────────────────────────────────
        const cached = await db.thumbnailCache.get(thumbnail!);
        if (cached) {
          db.thumbnailCache
            .update(thumbnail!, { lastAccessed: Date.now() })
            .catch(() => {});
          if (!cancelled) {
            objectUrl = URL.createObjectURL(cached.blob);
            setUrl(objectUrl);
          }
          return;
        }

        // ── 2. Batch-fetch signed URL (coalesced with other visible tiles)
        const signedUrl = await requestUrl(thumbnail!);
        if (cancelled) return;

        // ── 3. Download via proxy with concurrency limit ─────────────────
        await acquireSlot();
        if (cancelled) {
          releaseSlot();
          return;
        }

        let data: ArrayBuffer;
        try {
          const fileRes = await fetch(signedUrl, { signal: abortCtrl.signal });
          if (!fileRes.ok)
            throw new Error(`thumbnail proxy HTTP ${fileRes.status}`);
          data = await fileRes.arrayBuffer();
        } finally {
          releaseSlot(); // always released — slot is freed or transferred to next waiter
        }

        if (cancelled) return;

        // ── 4. Decrypt if the blob starts with "enc:" ────────────────────
        let blob: Blob;
        const text = new TextDecoder().decode(data.slice(0, 8)); // peek prefix
        if (text.startsWith("enc:") && decryptionKey) {
          const fullText = new TextDecoder().decode(data);
          const { decryptThumbnail } = await import(
            "@/lib/crypto/fileEncryption"
          );
          const decryptedB64 = await decryptThumbnail(fullText, decryptionKey);
          const response = await fetch(decryptedB64);
          blob = await response.blob();
        } else {
          blob = new Blob([data], { type: "image/jpeg" });
        }

        if (cancelled) return;

        // ── 5. Store in Dexie with LRU eviction ──────────────────────────
        const count = await db.thumbnailCache.count();
        if (count >= MAX_THUMBNAILS) {
          const oldest = await db.thumbnailCache
            .orderBy("lastAccessed")
            .first();
          if (oldest) await db.thumbnailCache.delete(oldest.id);
        }
        await db.thumbnailCache.put({
          id: thumbnail!,
          blob,
          lastAccessed: Date.now(),
        });

        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch (err) {
        // Tile scrolled out of view — fetch was intentionally cancelled.
        // The inner try/finally already released the semaphore slot.
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("useThumbnail error:", err);
        if (!cancelled) setUrl(null);
      }
    }

    loadThumbnail();

    return () => {
      cancelled = true;
      // Abort any in-flight GET /api/files/ request for this thumbnail.
      // Fires when: thumbnail → undefined (tile left viewport), deps changed,
      // or the component unmounts.
      abortCtrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnail, decryptionKey, userId]);

  return url;
}
