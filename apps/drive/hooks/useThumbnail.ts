/** Visible thumbnail URLs are coalesced and fetched directly from R2.
 * Decrypted thumbnails live only in the bounded memory cache.
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
// Limits simultaneous direct R2 GET requests so the server is not flooded
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

interface PendingThumbnailRequest {
  key: string;
  headers: Headers;
  resolvers: PendingResolver[];
}

/** Requests awaiting the next flush, isolated by Space scope and object key. */
const _pendingResolvers = new Map<string, PendingThumbnailRequest>();

/**
 * In-flight dedup map: once a key has been queued its Promise is stored here
 * so a second call for the same key within the coalesce window returns the
 * same Promise instead of enqueuing a duplicate.
 * Entries are removed when the promise settles (so retries work after failure).
 */
const _inFlightPromises = new Map<string, Promise<string>>();

let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function requestIdentity(key: string, headers: Headers): string {
  const spaceId = headers.get("x-xenode-space-id") ?? "personal";
  return `${spaceId}\u0000${key}`;
}

async function flushBatch() {
  _flushTimer = null;

  // Drain the pending map atomically.
  const snapshot = new Map(_pendingResolvers);
  _pendingResolvers.clear();

  if (snapshot.size === 0) return;

  const scopeGroups = new Map<
    string,
    { headers: Headers; entries: Array<[string, PendingThumbnailRequest]> }
  >();
  for (const [identity, request] of snapshot) {
    const scopeId =
      request.headers.get("x-xenode-space-id") ?? "personal";
    const group = scopeGroups.get(scopeId) ?? {
      headers: request.headers,
      entries: [],
    };
    group.entries.push([identity, request]);
    scopeGroups.set(scopeId, group);
  }

  await Promise.all(
    Array.from(scopeGroups.values()).flatMap((group) => {
      const chunks: Array<Array<[string, PendingThumbnailRequest]>> = [];
      for (let i = 0; i < group.entries.length; i += MAX_BATCH_KEYS) {
        chunks.push(group.entries.slice(i, i + MAX_BATCH_KEYS));
      }
      return chunks.map(async (chunk) => {
        const keys = chunk.map(([, request]) => request.key);
        try {
          const res = await fetch("/api/objects/thumbnail/batch", {
            method: "POST",
            credentials: "include",
            headers: {
              ...Object.fromEntries(group.headers),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ keys }),
          });

          if (!res.ok) throw new Error(`thumbnail/batch HTTP ${res.status}`);

          const { urls } = (await res.json()) as {
            urls: Record<string, string>;
          };

          for (const [identity, request] of chunk) {
            const url = urls[request.key];
            if (url) {
              request.resolvers.forEach((resolver) => resolver.resolve(url));
            } else {
              request.resolvers.forEach((resolver) =>
                resolver.reject(
                  new Error(
                    `No signed URL returned for thumbnail key "${request.key}"`,
                  ),
                ),
              );
            }
            _inFlightPromises.delete(identity);
          }
        } catch (err) {
          for (const [identity, request] of chunk) {
            request.resolvers.forEach((resolver) => resolver.reject(err));
            _inFlightPromises.delete(identity);
          }
        }
      });
    }),
  );
}

/**
 * Queue `key` for URL batch. Returns a Promise that resolves to the signed
 * proxy URL once the batch fires. Deduped within the coalesce window.
 */
function requestUrl(key: string, headers?: HeadersInit): Promise<string> {
  const scopedHeaders = new Headers(headers);
  const identity = requestIdentity(key, scopedHeaders);
  if (_inFlightPromises.has(identity)) {
    return _inFlightPromises.get(identity)!;
  }

  const promise = new Promise<string>((resolve, reject) => {
    const pending = _pendingResolvers.get(identity) ?? {
      key,
      headers: scopedHeaders,
      resolvers: [],
    };
    pending.resolvers.push({ resolve, reject });
    _pendingResolvers.set(identity, pending);
  });

  _inFlightPromises.set(identity, promise);

  if (!_flushTimer) {
    _flushTimer = setTimeout(() => flushBatch(), COALESCE_MS);
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
  fileId: string | undefined,
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
  return `${userId ?? "public"}\u0000${keyScope}\u0000${fileId ?? ""}\u0000${thumbnail}`;
}

/** A thumbnail renders only if it opens as this file's thumbnail; never plaintext. */
async function decodeDownloadedThumbnail(
  data: ArrayBuffer,
  decryptionKey: CryptoKey | null,
  fileId: string | undefined,
): Promise<Blob | null> {
  if (!decryptionKey || !fileId) return null;
  const { decryptThumbnail } = await import("@/lib/crypto/fileEncryption");
  const dataUrl = await decryptThumbnail(new TextDecoder().decode(data), decryptionKey, fileId);
  // Decoded in memory: the page CSP's connect-src does not allow fetching data: URLs.
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) return null;
  return new Blob([Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))], { type: match[1] });
}
export const __thumbnailDecodeTestUtils =
  process.env.NODE_ENV === "test"
    ? { decodeDownloadedThumbnail }
    : undefined;

export function useThumbnail(
  thumbnail: string | undefined,
  decryptionKey: CryptoKey | null,
  /** The object the thumbnail belongs to. */
  fileId: string | undefined,
) {
  const [url, setUrl] = useState<string | null>(null);
  const { data: session } = useSession();
  const workspace = useOptionalWorkspace();
  const userId = session?.user?.id;
  const thumbnailCacheKey = thumbnail
    ? thumbnailCacheIdentity(thumbnail, userId, decryptionKey, fileId)
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

    let cancelled = false;
    // AbortController cancels the in-flight direct R2 GET fetch when the
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

        // ── 3. Download directly from R2 with concurrency limit ─────────────────
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

        // ── 4. Open the sealed thumbnail ─────────────────────────────────
        const blob = await decodeDownloadedThumbnail(data, decryptionKey, fileId);
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
      // Abort any in-flight direct R2 GET request for this thumbnail.
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

