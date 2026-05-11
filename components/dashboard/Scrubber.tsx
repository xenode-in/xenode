/**
 * Scrubber — vertical timeline component for the photos gallery.
 *
 * Consumes the lightweight metadata feed (id + createdAt) from
 * /api/objects/metadata via `useObjectsMetadata`, computes year boundary
 * positions, and lets the user drag a thumb to scroll the gallery to a
 * specific date. Designed to render fast and stay cheap regardless of
 * library size — we never touch image data here.
 *
 * Integration contract:
 *   - Parent renders the gallery scroll container and the scrubber
 *     side-by-side (gallery flex:1, scrubber fixed ~48px).
 *   - Parent passes the same `items` array of ObjectMetadata that's
 *     driving the gallery layout.
 *   - When the user drags, `onScrub(index)` fires with the array index
 *     that maps to the date under the thumb. Parent should scroll its
 *     virtualized list to that index.
 *   - Parent also reports back the current scroll progress (0..1) via
 *     `scrollProgress` so the thumb reflects passive scrolling, not
 *     just dragging.
 *
 * Performance notes:
 *   - Year markers are memoized off `items` — recomputed only when the
 *     metadata list reference changes (effectively once per session).
 *   - Drag uses pointer events with `setPointerCapture` so the
 *     interaction stays responsive even if the cursor leaves the
 *     scrubber bounds.
 *   - We deliberately do NOT render a marker per photo — that would
 *     blow up at 5000+ items. Only year boundaries get markers, and
 *     the drag label shows the precise month/year under the thumb.
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ObjectMetadata } from "@/hooks/useLazyGallery";

const THUMB_HEIGHT = 36;
const THUMB_HALF = THUMB_HEIGHT / 2;

interface ScrubberProps {
  /**
   * The metadata array driving the gallery, sorted newest-first.
   * Same reference the gallery uses for layout.
   */
  items: ObjectMetadata[];
  /**
   * Current scroll progress of the gallery viewport, 0 (top) to 1
   * (bottom). Drives the thumb position when the user isn't dragging.
   */
  scrollProgress: number;
  /**
   * Called when the user drags the thumb. `index` is the array
   * position of the photo under the thumb. Parent scrolls to it.
   */
  onScrub: (index: number) => void;
}

interface YearMarker {
  year: number;
  /** Index of the first item belonging to this year (newest in the year). */
  firstIndex: number;
}

function buildYearMarkers(items: ObjectMetadata[]): YearMarker[] {
  const markers: YearMarker[] = [];
  let lastYear: number | null = null;
  for (let i = 0; i < items.length; i++) {
    const t = new Date(items[i].createdAt).getFullYear();
    if (!Number.isFinite(t)) continue;
    if (t !== lastYear) {
      markers.push({ year: t, firstIndex: i });
      lastYear = t;
    }
  }
  return markers;
}

function fmtDragLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

export function Scrubber({ items, scrollProgress, onScrub }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  // While dragging, the thumb follows the pointer instead of scrollProgress.
  const [dragProgress, setDragProgress] = useState<number | null>(null);

  // Measure the track once and on resize so the thumb math stays accurate.
  useEffect(() => {
    if (!trackRef.current) return;
    const el = trackRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        setTrackHeight(h);
      }
    });
    ro.observe(el);
    setTrackHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  // Year markers: rebuilt only when the items reference changes.
  const yearMarkers = useMemo(() => buildYearMarkers(items), [items]);

  // Current effective progress: drag wins, scroll otherwise.
  const effectiveProgress = dragProgress ?? scrollProgress;
  const thumbY =
    THUMB_HALF + effectiveProgress * Math.max(0, trackHeight - THUMB_HEIGHT);

  // Label shown next to the thumb while dragging. Picked off the item
  // whose array index corresponds to the drag position.
  const dragLabel = useMemo(() => {
    if (dragProgress == null || items.length === 0) return "";
    const idx = Math.min(
      items.length - 1,
      Math.max(0, Math.round(dragProgress * (items.length - 1))),
    );
    return fmtDragLabel(items[idx].createdAt);
  }, [dragProgress, items]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!trackRef.current || items.length === 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      handlePointerMove(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = trackRef.current;
      if (!el || items.length === 0) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const clamped = Math.min(
        Math.max(0, y - THUMB_HALF),
        rect.height - THUMB_HEIGHT,
      );
      const progress = clamped / Math.max(1, rect.height - THUMB_HEIGHT);
      setDragProgress(progress);

      const idx = Math.min(
        items.length - 1,
        Math.max(0, Math.round(progress * (items.length - 1))),
      );
      onScrub(idx);
    },
    [items, onScrub],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      handlePointerMove(e);
    },
    [dragging, handlePointerMove],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    setDragProgress(null);
  }, []);

  return (
    <div className="relative h-full w-12 select-none">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Photos timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, items.length - 1)}
        aria-valuenow={Math.round(effectiveProgress * (items.length - 1))}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute inset-y-0 right-1 w-10 cursor-grab touch-none active:cursor-grabbing"
      >
        {/* Track rail */}
        <div className="absolute inset-y-0 right-2 w-px bg-white/15" />

        {/* Year markers — render only when the track is measured */}
        {trackHeight > 0 &&
          yearMarkers.map((m) => {
            const top =
              THUMB_HALF +
              (m.firstIndex / Math.max(1, items.length - 1)) *
                (trackHeight - THUMB_HEIGHT) -
              8;
            return (
              <div
                key={m.year}
                style={{ top }}
                className="absolute right-5 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] font-semibold leading-none text-zinc-300 ring-1 ring-white/5"
              >
                {m.year}
              </div>
            );
          })}

        {/* Thumb */}
        <div
          style={{ top: thumbY - THUMB_HALF }}
          className={`absolute right-1 flex items-center justify-end ${
            dragging ? "scale-105" : ""
          }`}
        >
          {dragging && dragLabel ? (
            <div className="mr-3 whitespace-nowrap rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-1.5 text-xs font-semibold text-white shadow-xl">
              {dragLabel}
            </div>
          ) : null}
          <div
            style={{ height: THUMB_HEIGHT, width: 16 }}
            className={`rounded-full border border-white/20 shadow-md ${
              dragging ? "bg-white" : "bg-zinc-300/95"
            }`}
          />
        </div>
      </div>
    </div>
  );
}
