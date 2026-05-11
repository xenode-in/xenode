/**
 * useLazyGallery — two hooks that power the lazy-loaded timeline gallery.
 *
 *   1. useObjectsMetadata(bucketId)
 *      — fetches the lightweight `{ _id, createdAt }` list once,
 *        caches via React Query, drives the scrubber + grid layout.
 *
 *   2. useObjectsBatch(bucketId)
 *      — returns a `request(ids: string[]) => void` function that
 *        coalesces calls within a ~50ms window and dedupes against
 *        an in-memory cache. Each batch hits POST /api/objects/batch
 *        for at most MAX_BATCH ids at a time and merges results into
 *        the cache. Consumers read by id from the same cache.
 *
 * The contract: the gallery iterates the metadata list, lays out
 * empty slots, and as IntersectionObserver fires on each slot it
 * calls `request([slot._id])`. Multiple intersections in the same
 * frame get coalesced into one network call.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/**
 * The minimal shape returned by /api/objects/metadata. Used to size the
 * gallery, render scrubber markers, and key the per-id full fetches.
 */
export interface ObjectMetadata {
  _id: string;
  createdAt: string; // ISO 8601
}

/**
 * Full object shape from /api/objects/batch — mirrors /api/objects.
 * Only the fields the gallery actually reads are typed strictly; the
 * rest are passed through for callers that need them.
 */
export interface FullObject extends ObjectMetadata {
  key: string;
  size?: number;
  contentType?: string;
  encryptedContentType?: string | null;
  thumbnail?: string;
  thumbnailUrl?: string | null;
  optimizedUrl?: string | null;
  optimizedKey?: string;
  optimizedEncryptedDEK?: string;
  optimizedIV?: string;
  optimizedSize?: number;
  aspectRatio?: number;
  encryptedName?: string | null;
  encryptedDisplayName?: string | null;
  isEncrypted?: boolean;
  mediaCategory?: string;
  tags?: string[];
  position?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// useObjectsMetadata — one-shot lightweight fetch
// ─────────────────────────────────────────────────────────────────────────

export function useObjectsMetadata(
  bucketId: string | null,
  opts?: { mediaCategory?: string; contentType?: string },
) {
  return useQuery({
    queryKey: [
      "objects-metadata",
      bucketId,
      opts?.mediaCategory ?? null,
      opts?.contentType ?? null,
    ],
    queryFn: async () => {
      if (!bucketId) return { count: 0, items: [] as ObjectMetadata[] };
      const params = new URLSearchParams({ bucketId });
      if (opts?.mediaCategory) params.set("mediaCategory", opts.mediaCategory);
      if (opts?.contentType) params.set("contentType", opts.contentType);
      const res = await fetch(`/api/objects/metadata?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`metadata fetch ${res.status}: ${txt.slice(0, 200)}`);
      }
      return (await res.json()) as { count: number; items: ObjectMetadata[] };
    },
    enabled: !!bucketId,
    // The metadata list is stable enough to share across remounts; the
    // server caches for 30s, so we keep the client copy fresh-ish.
    staleTime: 30_000,
    // Hold onto the resolved data so route transitions don't refetch.
    gcTime: 5 * 60_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// useObjectsBatch — coalesced lazy fetcher
// ─────────────────────────────────────────────────────────────────────────

const COALESCE_MS = 50; // window for collecting viewport-triggered ids
const MAX_BATCH = 200; // matches server cap

interface BatchState {
  /** Resolved full objects by id. */
  cache: Map<string, FullObject>;
  /** IDs we've already requested (in-flight or completed). */
  requested: Set<string>;
  /** IDs queued for the next flush. */
  pending: Set<string>;
  /** setTimeout handle for the pending flush. */
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Returns a tuple of [cache, requestIds]:
 *
 *   cache       — Map<id, FullObject>. Trigger re-renders by passing the
 *                 returned `version` number into a useMemo dep on the
 *                 consuming component.
 *   requestIds  — call with one or many ids; safe to invoke from inside
 *                 IntersectionObserver callbacks. Dedup + coalesce is
 *                 handled internally so 30 simultaneous calls produce
 *                 one network request.
 *
 * Cache is keyed per-bucket; switching bucketId clears the previous
 * cache to avoid cross-tenant data leaks in dev.
 */
export function useObjectsBatch(bucketId: string | null) {
  const stateRef = useRef<BatchState>({
    cache: new Map(),
    requested: new Set(),
    pending: new Set(),
    flushTimer: null,
  });
  const lastBucketRef = useRef<string | null>(null);
  // Bumped on every cache mutation so consumers can useMemo against it.
  const [version, setVersion] = useState(0);

  // Reset state when bucketId changes.
  useEffect(() => {
    if (lastBucketRef.current !== bucketId) {
      lastBucketRef.current = bucketId;
      const s = stateRef.current;
      s.cache.clear();
      s.requested.clear();
      s.pending.clear();
      if (s.flushTimer) {
        clearTimeout(s.flushTimer);
        s.flushTimer = null;
      }
      setVersion((v) => v + 1);
    }
  }, [bucketId]);

  const flush = useCallback(async () => {
    const s = stateRef.current;
    s.flushTimer = null;
    if (!bucketId || s.pending.size === 0) return;

    // Drain the pending set, capped at MAX_BATCH per request. Any leftover
    // ids are re-queued for the next tick.
    const ids: string[] = [];
    for (const id of s.pending) {
      ids.push(id);
      if (ids.length >= MAX_BATCH) break;
    }
    for (const id of ids) s.pending.delete(id);

    if (s.pending.size > 0) {
      // Re-arm immediately so the overflow flushes on the next tick.
      s.flushTimer = setTimeout(flush, COALESCE_MS);
    }

    try {
      const res = await fetch(`/api/objects/batch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId, ids }),
      });
      if (!res.ok) {
        // Roll back so a retry will re-request these — leaving them in
        // `requested` would silently strand them with no data.
        for (const id of ids) s.requested.delete(id);
        return;
      }
      const body = (await res.json()) as {
        items: Record<string, FullObject>;
      };
      for (const id of Object.keys(body.items)) {
        s.cache.set(id, body.items[id]);
      }
      // Any id we asked for but didn't get back (deleted, etc.) stays in
      // `requested` so we don't retry it — there's nothing to fetch.
      setVersion((v) => v + 1);
    } catch {
      for (const id of ids) s.requested.delete(id);
    }
  }, [bucketId]);

  const requestIds = useCallback(
    (ids: string | string[]) => {
      const s = stateRef.current;
      const list = typeof ids === "string" ? [ids] : ids;
      let added = false;
      for (const id of list) {
        if (!id || s.requested.has(id) || s.cache.has(id)) continue;
        s.requested.add(id);
        s.pending.add(id);
        added = true;
      }
      if (added && !s.flushTimer) {
        s.flushTimer = setTimeout(flush, COALESCE_MS);
      }
    },
    [flush],
  );

  return {
    /** Map<id, FullObject>. Read-only — mutate via `requestIds`. */
    cache: stateRef.current.cache,
    /** Increments on every batch resolve; use as a useMemo dep. */
    version,
    /** Trigger a fetch for one or more ids. Safe to spam — dedupes. */
    requestIds,
  };
}
