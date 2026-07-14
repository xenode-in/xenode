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

import { useState, useEffect, useRef } from "react";
import { useSession } from "@/lib/auth/client";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import {
  getCachedThumbnail,
  getThumbnailCacheGeneration,
  onThumbnailMemoryCacheCleared,
  putCachedThumbnail,
} from "@/lib/thumbnails/memoryCache";

const COALESCE_MS = 50;
const MAX_BATCH_KEYS = 50;
const MAX_CONCURRENT_DOWNLOADS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level ephemeral thumbnail cache
//
// Decrypted thumbnails are plaintext, so they must never be persisted to disk.
// The durable Dexie `thumbnailCache` table was removed in the v5 migration
// (lib/db/local.ts); this in-memory LRU replaces it. Blobs live only for the
// tab session and are evicted at MAX_THUMBNAILS. Each hook instance mints (and
// revokes) its own object URL from the shared Blob, so caching the Blob — not a
// URL — is safe across many mounted tiles.
// ─────────────────────────────────────────────────────────────────────────────

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

function acquireSlot(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    if (_activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      _activeDownloads++; // slot acquired immediately
      resolve();
      return;
    }

    let settled = false;
    const waiter = () => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    const onAbort = () => {
      if (settled) return;
      const idx = _downloadQueue.indexOf(waiter);
      if (idx !== -1) _downloadQueue.splice(idx, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    _downloadQueue.push(waiter); // wait; slot transferred by releaseSlot
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

async function flushBatch(headers?: HeadersInit) {
  _flushTimer = null;

  // Drain the pending map atomically.
  const snapshot = new Map(_pendingResolvers);
  _pendingResolvers.clear();

  if (snapshot.size === 0) return;

  const keys = Array.from(snapshot.keys());

  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += MAX_BATCH_KEYS) {
    chunks.push(keys.slice(i, i + MAX_BATCH_KEYS));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch("/api/objects/thumbnail/batch", {
          method: "POST",
          credentials: "include",
          headers: { ...Object.fromEntries(new Headers(headers)), "Content-Type": "application/json" },
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
    }),
  );
}

/**
 * Queue `key` for URL batch. Returns a Promise that resolves to the signed
 * proxy URL once the batch fires. Deduped within the coalesce window.
 */
function requestUrl(key: string, headers?: HeadersInit): Promise<string> {
  if (_inFlightPromises.has(key)) return _inFlightPromises.get(key)!;

  const promise = new Promise<string>((resolve, reject) => {
    if (!_pendingResolvers.has(key)) _pendingResolvers.set(key, []);
    _pendingResolvers.get(key)!.push({ resolve, reject });
  });

  _inFlightPromises.set(key, promise);

  if (!_flushTimer) {
    _flushTimer = setTimeout(() => flushBatch(headers), COALESCE_MS);
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
 * When `thumbnail` toggles to `undefined` (e.g. item scrolled out of view),
 * any in-flight fetch is aborted but the already-loaded blob URL is kept —
 * so the user sees a cached thumbnail if they scroll back.  Object URLs are
 * only revoked when replaced by a new load or on full component unmount.
 *
 * @param thumbnail  B2 key string, base64 data URI, or undefined.
 * @param decryptionKey  CryptoKey used to decrypt `enc:` thumbnails (optional).
 */
let nextCryptoKeyId = 0;
const cryptoKeyIds = new WeakMap<CryptoKey, number>();

function thumbnailCacheIdentity(
  thumbnail: string,
  userId: string | undefined,
  decryptionKey: CryptoKey | null,
): string {
  let keyScope = "unencrypted";
  if (decryptionKey) {
    let keyId = cryptoKeyIds.get(decryptionKey);
    if (!keyId) {
      keyId = ++nextCryptoKeyId;
      cryptoKeyIds.set(decryptionKey, keyId);
    }
    keyScope = `key-${keyId}`;
  }
  return `${userId ?? "public"}\u0000${keyScope}\u0000${thumbnail}`;
}

async function decodeDownloadedThumbnail(
  data: ArrayBuffer,
  decryptionKey: CryptoKey | null,
): Promise<Blob | null> {
  const prefix = new TextDecoder().decode(data.slice(0, 8));
  if (!prefix.startsWith("enc:")) {
    return new Blob([data], { type: "image/jpeg" });
  }
  if (!decryptionKey) return null;
  const fullText = new TextDecoder().decode(data);
  const { decryptThumbnail } = await import("@/lib/crypto/fileEncryption");
  const decryptedDataUrl = await decryptThumbnail(fullText, decryptionKey);
  const blob = await (await fetch(decryptedDataUrl)).blob();
  return blob.type.startsWith("image/") ? blob : null;
}
export const __thumbnailDecodeTestUtils =
  process.env.NODE_ENV === "test"
    ? { decodeDownloadedThumbnail }
    : undefined;

export function useThumbnail(
  thumbnail: string | undefined,
  decryptionKey: CryptoKey | null = null,
) {
  const [url, setUrl] = useState<string | null>(null);
  const { data: session } = useSession();
  const workspace = useOptionalWorkspace();
  const userId = session?.user?.id;
  const thumbnailCacheKey = thumbnail
    ? thumbnailCacheIdentity(thumbnail, userId, decryptionKey)
    : null;

  // Track the current object URL in a ref so we can revoke it when replaced
  // or on unmount, WITHOUT revoking it during intermediate effect cleanups
  // (which would break already-displayed thumbnails).
  const objectUrlRef = useRef<string | null>(null);

  // Track which thumbnail key the current URL belongs to, so we don't
  // re-load a thumbnail that's already displayed.
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return onThumbnailMemoryCacheCleared(() => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      loadedKeyRef.current = null;
      setUrl(null);
    });
  }, []);

  useEffect(() => {
    // When thumbnail is undefined (item scrolled out of view), abort any
    // in-flight work but DON'T clear the displayed URL.  The user may
    // scroll back and the cached thumbnail should still be visible.
    if (!thumbnail) {
      return;
    }

    // Skip re-loading if the current URL already belongs to this key.
    if (loadedKeyRef.current === thumbnailCacheKey && objectUrlRef.current) {
      return;
    }

    // Legacy base64 thumbnails — serve immediately, no fetch needed.
    if (thumbnail.startsWith("data:")) {
      setUrl(thumbnail);
      loadedKeyRef.current = thumbnailCacheKey;
      return;
    }

    let cancelled = false;
    // AbortController cancels the in-flight GET /api/files/ fetch when the
    // tile scrolls out of view or thumbnail prop changes before download completes.
    const abortCtrl = new AbortController();
    const cacheGeneration = getThumbnailCacheGeneration();

    async function loadThumbnail() {
      const isPublicShareThumbnail = thumbnail!.startsWith("shares/");
      if (!userId && !isPublicShareThumbnail) return; // wait for session

      try {
        // ── 1. In-memory LRU cache (ephemeral — never touches disk) ──────
        const cachedBlob = getCachedThumbnail(thumbnailCacheKey!);
        if (cachedBlob) {
          if (!cancelled) {
            // Revoke previous object URL before creating new one
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = URL.createObjectURL(cachedBlob);
            loadedKeyRef.current = thumbnailCacheKey;
            setUrl(objectUrlRef.current);
          }
          return;
        }

        // ── 2. Batch-fetch signed URL (coalesced with other visible tiles)
        const signedUrl = await requestUrl(
          thumbnail!,
          workspace?.scopedHeaders(),
        );
        if (cancelled) return;

        // ── 3. Download via proxy with concurrency limit ─────────────────
        await acquireSlot(abortCtrl.signal);
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
        const blob = await decodeDownloadedThumbnail(data, decryptionKey);
        if (!blob) return;

        if (cancelled) return;

        // ── 5. Store in the in-memory LRU (no disk persistence) ──────────
        if (!putCachedThumbnail(thumbnailCacheKey!, blob, cacheGeneration)) {
          return;
        }

        if (!cancelled) {
          // Revoke previous object URL before creating new one
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = URL.createObjectURL(blob);
          loadedKeyRef.current = thumbnailCacheKey;
          setUrl(objectUrlRef.current);
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
      // Fires when: thumbnail → undefined (tile left viewport), deps changed.
      // We intentionally do NOT revoke objectUrlRef here — the blob URL must
      // stay valid so the already-rendered <img> doesn't flash/break.
      abortCtrl.abort();
    };
  }, [thumbnail, thumbnailCacheKey, decryptionKey, userId, workspace]);

  // Revoke the object URL only on full component unmount.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  return url;
}

