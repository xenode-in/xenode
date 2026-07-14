/**
 * LazyPhotosGallery — photo grid with date scrubber, powered by a single
 * upfront data fetch.
 *
 * Architecture:
 *
 *   useGridObjects(bucketId)
 *     → one GET /api/objects/grid call
 *     → returns { _id, createdAt, thumbnail, aspectRatio, … }[] for ALL items
 *
 *   Gallery renders ALL section headers + tile shells immediately.
 *   No "blank jump" when scrubber navigates to a distant section.
 *
 *   Thumbnail *images* still load lazily:
 *     LazyTile → IntersectionObserver fires → useThumbnail(item.thumbnail)
 *     → batched POST /api/objects/thumbnail/batch-content (50 ms coalesce)
 *     → decrypted client-side with metadataKey from CryptoContext
 *     → blob URL stored in Dexie LRU cache (500 entries)
 *
 * Scrubber wiring (same as before):
 *   - onScroll: binary search on pre-cached offsetTops → scrollProgress
 *   - onScrub:  section label dedup → scrollTo instantly
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";

import { GridObject, useGridObjects } from "@/hooks/useLazyGallery";
import { useThumbnail } from "@/hooks/useThumbnail";
import { useCrypto } from "@/contexts/CryptoContext";
import { Scrubber } from "./Scrubber";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  bucketId: string | null;
  mediaCategory?: string;
  /** Called when the user clicks a tile. Use to open a lightbox. */
  onPhotoClick?: (item: GridObject) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main gallery
// ─────────────────────────────────────────────────────────────────────────────

export function LazyPhotosGallery({
  bucketId,
  mediaCategory,
  onPhotoClick,
}: Props) {
  const { data, isLoading, isError } = useGridObjects(bucketId, {
    mediaCategory,
  });
  const { metadataKey } = useCrypto();

  const items: GridObject[] = data?.items ?? [];

  // ── Scrubber state ─────────────────────────────────────────────────────────

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  /** Label of the last scrub target, used to deduplicate drag updates. */
  const lastScrubTargetLabelRef = useRef<string | null>(null);

  /** Label of the section currently reflected by scrollProgress. */
  const lastActiveScrollLabelRef = useRef<string | null>(null);

  /** Refs to each section's root <section> element. */
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  /** Pre-cached { label, top, indexStart } for O(log n) binary search. */
  const sectionOffsetsRef = useRef<
    Array<{ label: string; top: number; indexStart: number }>
  >([]);

  /** RAF handle — caps scroll handler at 60 fps. */
  const rafRef = useRef<number | null>(null);

  // ── Date sections (memoized) ───────────────────────────────────────────────

  const sections = useMemo(() => {
    const out: Array<{
      label: string;
      indexStart: number;
      indexEnd: number;
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
          indexEnd: items.length,
        });
        lastKey = key;
      }
    }
    return out;
  }, [items]);

  // ── Measure offsetTops after layout (stable after first load) ──────────────

  const measureOffsets = useCallback(() => {
    const result: typeof sectionOffsetsRef.current = [];
    for (const sec of sections) {
      const el = sectionRefs.current[sec.label];
      if (el) {
        result.push({
          label: sec.label,
          top: el.offsetTop,
          indexStart: sec.indexStart,
        });
      }
    }
    sectionOffsetsRef.current = result;
  }, [sections]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      measureOffsets();
    });
    ro.observe(el);

    measureOffsets();

    return () => ro.disconnect();
  }, [measureOffsets]);

  // ── Scroll handler (RAF-gated, binary search) ──────────────────────────────

  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const offsets = sectionOffsetsRef.current;
      if (offsets.length === 0 || items.length === 0) return;

      const container = scrollRef.current;
      if (!container) return;
      const scrollTop = container.scrollTop;
      const THRESHOLD = 80;

      // Binary search for the bottom-most section whose top ≤ scrollTop + THRESHOLD.
      let lo = 0;
      let hi = offsets.length - 1;
      let activeIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid].top <= scrollTop + THRESHOLD) {
          activeIdx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      if (activeIdx === -1) {
        setScrollProgress(0);
        lastActiveScrollLabelRef.current = null;
        lastScrubTargetLabelRef.current = null;
        return;
      }

      const { label, indexStart } = offsets[activeIdx];
      // Skip state update if still in the same section.
      if (label === lastActiveScrollLabelRef.current) return;
      lastActiveScrollLabelRef.current = label;
      if (label === lastScrubTargetLabelRef.current) {
        lastScrubTargetLabelRef.current = null;
      }
      setScrollProgress(indexStart / Math.max(1, items.length - 1));
    });
  }, [items.length]);

  // ── Scrub handler (instant scroll to section) ──────────────────────────────

  const onScrub = useCallback(
    (index: number) => {
      const iso = items[index]?.createdAt;
      if (!iso) return;

      const d = new Date(iso);
      const label = d.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });

      const container = scrollRef.current;
      const sEl = sectionRefs.current[label];
      if (!sEl || !container || label === lastScrubTargetLabelRef.current) return;

      setScrollProgress(index / Math.max(1, items.length - 1));
      lastScrubTargetLabelRef.current = label;

      container.scrollTo({
        top: Math.max(0, sEl.offsetTop + 100),
        behavior: "smooth",
      });
    },
    [items],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

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
      {/* Scrollable grid */}
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
              {items.slice(section.indexStart, section.indexEnd).map((item) => (
                <LazyTile
                  key={item._id}
                  item={item}
                  decryptionKey={metadataKey}
                  onClick={onPhotoClick}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Scrubber */}
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

// ─────────────────────────────────────────────────────────────────────────────
// LazyTile — one cell in the grid.
//
// The tile shape (aspectRatio, date) is available immediately from the grid
// fetch. Thumbnail image loading is deferred until the tile enters the
// viewport (400px rootMargin prefetch), then handed off to useThumbnail
// which batches the B2 fetch via POST /api/objects/thumbnail/batch-content.
// ─────────────────────────────────────────────────────────────────────────────

interface TileProps {
  item: GridObject;
  decryptionKey: CryptoKey | null;
  onClick?: (item: GridObject) => void;
}

const LazyTile = memo(function LazyTile({
  item,
  decryptionKey,
  onClick,
}: TileProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Flip to true once the tile enters the viewport — triggers useThumbnail.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return; // already triggered; don't re-observe
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Pass the thumbnail key only when visible; useThumbnail handles batching.
  const thumbUrl = useThumbnail(
    visible && item.thumbnail ? item.thumbnail : undefined,
    decryptionKey,
  );

  return (
    <div
      ref={ref}
      style={{ aspectRatio: item.aspectRatio }}
      className="relative cursor-pointer overflow-hidden rounded-sm bg-zinc-800"
      onClick={() => onClick?.(item)}
    >
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
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
