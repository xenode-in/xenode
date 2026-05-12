/**
 * LazyPhotosGallery — example integration of the metadata + batch +
 * scrubber lazy-loading pipeline. Drop-in skeleton you can either use
 * directly or fold the relevant pieces into the existing PhotosGrid.
 *
 * Architecture:
 *
 *   ┌──────────────────────────────────────┐
 *   │ useObjectsMetadata(bucketId)         │
 *   │  → { _id, createdAt }[] (one fetch)  │
 *   └────────────┬─────────────────────────┘
 *                │
 *                ▼
 *   ┌──────────────────────────────────────┐
 *   │ Gallery lays out N empty slots,      │
 *   │ each with createdAt for date headers │
 *   │ and a stable id key.                 │
 *   └────────────┬─────────────────────────┘
 *                │ IntersectionObserver fires
 *                ▼
 *   ┌──────────────────────────────────────┐
 *   │ useObjectsBatch.requestIds([id])     │
 *   │  → coalesces 50ms window of ids      │
 *   │  → POST /api/objects/batch           │
 *   │  → cache.set(id, fullObject)         │
 *   └────────────┬─────────────────────────┘
 *                │
 *                ▼
 *   Tile re-renders with the full data
 *   (thumbnailUrl, optimizedUrl, etc).
 *
 * The scrubber consumes the same metadata array and emits target
 * indices on drag; we map index → DOM node and scroll to it.
 *
 * NOT included (intentional):
 *   - Virtualization. 5000 placeholder <div>s is fine in modern
 *     browsers; adding react-window is orthogonal and can layer in
 *     here later. The hook + scrubber design is virtualization-ready.
 *   - Decryption / display name resolution. That stays where it
 *     already lives in the gallery; this component is purely about
 *     fetch scheduling.
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  FullObject,
  ObjectMetadata,
  useObjectsBatch,
  useObjectsMetadata,
} from "@/hooks/useLazyGallery";
import { Scrubber } from "./Scrubber";

interface Props {
  bucketId: string | null;
  mediaCategory?: string;
}

export function LazyPhotosGallery({ bucketId, mediaCategory }: Props) {
  const { data, isLoading, isError } = useObjectsMetadata(bucketId, {
    mediaCategory,
  });
  const { cache, version, requestIds } = useObjectsBatch(bucketId);

  const items: ObjectMetadata[] = data?.items ?? [];

  // Scroll progress + scrubber wiring.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Refs to each section's root <section> element so we can scrollTo() them
  // precisely and also read their position for section-aware progress tracking.
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  // Deduplicate consecutive scrubs to the same label (prevents instant-scroll
  // spam while the thumb dwells on a section boundary during drag).
  const lastScrubLabelRef = useRef<string | null>(null);
  // Stable ref to the sections array so onScroll doesn't need it as a dep.
  const sectionsRef = useRef<
    Array<{ label: string; indexStart: number; indexEnd: number }>
  >([]);

  /**
   * Section-aware scroll progress.
   *
   * Walk the section headers (newest first) and find the bottom-most one
   * whose top edge is at or above a 80px threshold inside the container.
   * Map that section's `indexStart` → 0..1 to drive the scrubber thumb.
   *
   * This uses the same coordinate system as the scrubber markers
   * (photo-count index, not raw pixels) so the thumb stays in sync.
   */
  const onScroll = useCallback(() => {
    const container = scrollRef.current;
    const secs = sectionsRef.current;
    if (!container || secs.length === 0 || items.length === 0) return;

    const containerTop = container.getBoundingClientRect().top;
    const THRESHOLD = containerTop + 80; // px from viewport top

    let activeIndexStart = 0;
    let activeLabel: string | null = null;
    for (const sec of secs) {
      const el = sectionRefs.current[sec.label];
      if (!el) continue;
      if (el.getBoundingClientRect().top <= THRESHOLD) {
        activeIndexStart = sec.indexStart;
        activeLabel = sec.label;
      } else {
        break;
      }
    }

    // Keep last-seen label in sync so onScrub dedup stays accurate
    // after the user scrolls manually.
    lastScrubLabelRef.current = activeLabel;
    setScrollProgress(activeIndexStart / Math.max(1, items.length - 1));
  }, [items.length]);

  /**
   * onScrub — fired by the Scrubber on every pointer-move during drag.
   *
   * Maps the metadata index to its section label, deduplicates against the
   * previously-scrolled label, then jumps to the section's offsetTop with
   * `behavior: "instant"` so rapid drags never stack animations.
   *
   * We subtract 8px so the section header has a small breathing gap at the
   * top of the scroll container rather than being flush against the edge.
   */
  const onScrub = useCallback(
    (index: number) => {
      const iso = items[index]?.createdAt;
      if (!iso) return;

      const d = new Date(iso);
      const label = d.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });

      // Skip if we're already showing this section.
      if (label === lastScrubLabelRef.current) return;
      lastScrubLabelRef.current = label;

      const container = scrollRef.current;
      const sEl = sectionRefs.current[label];
      if (sEl && container) {
        // offsetTop is relative to the scroll container's offset parent.
        // Subtract a small margin so the heading isn't flush against the top.
        container.scrollTo({
          top: Math.max(0, sEl.offsetTop + 100),
          behavior: "smooth",
        });
      }
    },
    [items],
  );

  // Date-section headers: build month boundaries off the metadata.
  // Cheap (one pass over items) and memoized off the array reference.
  const sections = useMemo(() => {
    const out: Array<{
      label: string;
      indexStart: number;
      indexEnd: number; // exclusive
    }> = [];
    let lastKey: string | null = null;
    for (let i = 0; i < items.length; i++) {
      const d = new Date(items[i].createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key !== lastKey) {
        if (out.length > 0) out[out.length - 1].indexEnd = i;
        out.push({
          label: d.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          }),
          indexStart: i,
          indexEnd: items.length, // patched on next boundary
        });
        lastKey = key;
      }
    }
    return out;
  }, [items]);

  // Keep sectionsRef current so onScroll always sees the latest list
  // without needing sections in its dep array (which would re-register
  // the scroll handler on every metadata change).
  sectionsRef.current = sections;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        Loading…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        Failed to load gallery
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        No photos yet
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full flex-1 overflow-y-auto"
      >
        {sections.map((section) => (
          <section
            key={section.label}
            ref={(el) => {
              sectionRefs.current[section.label] = el;
            }}
          >
            <header className="sticky top-0 z-10 bg-zinc-950/90 px-4 py-2 text-sm font-semibold text-zinc-200 backdrop-blur">
              {section.label}
            </header>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1 px-1">
              {items.slice(section.indexStart, section.indexEnd).map((m) => (
                <LazyTile
                  key={m._id}
                  metadata={m}
                  full={cache.get(m._id)}
                  cacheVersion={version}
                  request={requestIds}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="h-full w-[88px] flex-shrink-0">
        <Scrubber
          items={items}
          scrollProgress={scrollProgress}
          onScrub={onScrub}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LazyTile — one cell in the grid. Renders a placeholder until the
// IntersectionObserver triggers a batch fetch; then swaps in the thumb.
// ─────────────────────────────────────────────────────────────────────────

interface TileProps {
  metadata: ObjectMetadata;
  full: FullObject | undefined;
  cacheVersion: number;
  request: (ids: string | string[]) => void;
}

const LazyTile = React.memo(function LazyTile({
  metadata,
  full,
  request,
}: TileProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (triggeredRef.current || full) return;
    const el = ref.current;
    if (!el) return;

    // 400px margin so the request fires well before the tile is
    // visible — matches the mobile gallery's prefetch window.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !triggeredRef.current) {
            triggeredRef.current = true;
            request(metadata._id);
            io.disconnect();
          }
        }
      },
      { rootMargin: "400px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [full, metadata._id, request]);

  const aspect = full?.aspectRatio ?? 1;

  return (
    <div
      ref={ref}
      style={{ aspectRatio: aspect }}
      className="relative overflow-hidden rounded-sm bg-zinc-800"
    >
      {full?.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={full.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-800 to-zinc-900" />
      )}
    </div>
  );
});
