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

const THUMB_SIZE = 14; // diameter of the circular thumb
const THUMB_HALF = THUMB_SIZE / 2;
const TRACK_RIGHT = 12; // px from container right edge to track centre-line
const DOT_SIZE = 5; // diameter of year/month marker dots on the track

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

interface TimelineMarker {
  label: string;
  count: number;
  /** Index of the first item in this segment (newest). */
  firstIndex: number;
}

/**
 * Builds adaptive timeline markers from the metadata list.
 * - ≤ 24 distinct months → show "MMM YYYY" (month-level)
 * - > 24 distinct months → show "YYYY" (year-level) to avoid crowding
 * Each marker carries a photo count for the segment.
 */
function buildTimelineMarkers(items: ObjectMetadata[]): TimelineMarker[] {
  if (items.length === 0) return [];

  // First pass: count per-month bucket
  const monthCounts = new Map<string, { count: number; firstIndex: number }>();
  for (let i = 0; i < items.length; i++) {
    const d = new Date(items[i].createdAt);
    if (!Number.isFinite(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    const existing = monthCounts.get(key);
    if (!existing) {
      monthCounts.set(key, { count: 1, firstIndex: i });
    } else {
      existing.count++;
    }
  }

  const useMonthLabels = monthCounts.size <= 24;

  if (useMonthLabels) {
    return Array.from(monthCounts.entries()).map(([key, { count, firstIndex }]) => {
      const [year, month] = key.split("-").map(Number);
      const d = new Date(year, month, 1);
      const label = d.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
      return { label, count, firstIndex };
    });
  }

  // Collapse to year-level
  const yearCounts = new Map<number, { count: number; firstIndex: number }>();
  for (const [key, { count, firstIndex }] of monthCounts) {
    const year = Number(key.split("-")[0]);
    const existing = yearCounts.get(year);
    if (!existing) {
      yearCounts.set(year, { count, firstIndex });
    } else {
      existing.count += count;
      existing.firstIndex = Math.min(existing.firstIndex, firstIndex);
    }
  }
  return Array.from(yearCounts.entries()).map(([year, { count, firstIndex }]) => ({
    label: String(year),
    count,
    firstIndex,
  }));
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

  // Timeline markers: rebuilt only when the items reference changes.
  const timelineMarkers = useMemo(() => buildTimelineMarkers(items), [items]);

  // Determine which labels to render to avoid overlap
  const visibleLabels = useMemo(() => {
    const visible: boolean[] = [];
    let lastY = -9999;
    const minSpacing = 20; // minimum pixels between label centers

    for (let i = 0; i < timelineMarkers.length; i++) {
      const m = timelineMarkers[i];
      const midY =
        THUMB_HALF +
        (m.firstIndex / Math.max(1, items.length - 1)) *
          (trackHeight - THUMB_SIZE);

      if (midY - lastY >= minSpacing) {
        visible.push(true);
        lastY = midY;
      } else {
        visible.push(false);
      }
    }
    return visible;
  }, [timelineMarkers, items.length, trackHeight]);

  // Current effective progress: drag wins, scroll otherwise.
  const effectiveProgress = dragProgress ?? scrollProgress;
  const thumbY =
    THUMB_HALF + effectiveProgress * Math.max(0, trackHeight - THUMB_SIZE);

  // Label shown next to the thumb while dragging — month/year of the item
  // under the thumb, plus the count for that marker segment.
  const dragLabel = useMemo(() => {
    if (dragProgress == null || items.length === 0) return "";
    const idx = Math.min(
      items.length - 1,
      Math.max(0, Math.round(dragProgress * (items.length - 1))),
    );
    const dateLabel = fmtDragLabel(items[idx].createdAt);
    // Find which timeline segment this index belongs to for the count
    let segmentCount: number | null = null;
    for (let m = 0; m < timelineMarkers.length; m++) {
      const nextStart = timelineMarkers[m + 1]?.firstIndex ?? items.length;
      if (idx >= timelineMarkers[m].firstIndex && idx < nextStart) {
        segmentCount = timelineMarkers[m].count;
        break;
      }
    }
    return segmentCount != null
      ? `${dateLabel} · ${segmentCount}`
      : dateLabel;
  }, [dragProgress, items, timelineMarkers]);

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
        rect.height - THUMB_SIZE,
      );
      const progress = clamped / Math.max(1, rect.height - THUMB_SIZE);
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

  /**
   * Layout (all positions relative to the track container):
   *
   *  ← container width (88px) →
   *  ┌──────────────────────────┐
   *  │  Label text   • │        │  marker row (dot sits on the 1px rail)
   *  │               │ │        │
   *  │               ○ │        │  thumb circle centred on rail
   *  │               │ │        │
   *  └──────────────────────────┘
   *
   *  TRACK_RIGHT = 12px from right edge  → rail x = containerWidth - 12
   *  DOT_SIZE    = 5px  → dot left = containerWidth - 12 - 2.5  (centre on rail)
   *  THUMB_SIZE  = 14px → thumb left = containerWidth - 12 - 7  (centre on rail)
   *  Label text: positioned absolutely, right = TRACK_RIGHT + DOT_SIZE/2 + 4
   *              (a small gap between text and the dot)
   */
  return (
    <div className="relative h-full w-[88px] select-none">
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
        className="absolute inset-y-6 inset-x-0 cursor-grab touch-none active:cursor-grabbing"
      >
        {/* Track rail — 1px vertical line */}
        <div
          className="absolute inset-y-0 w-px bg-white/20"
          style={{ right: TRACK_RIGHT }}
        />

        {/* Timeline markers — plain text + dot on rail */}
        {trackHeight > 0 &&
          timelineMarkers.map((m, idx) => {
            const midY =
              THUMB_HALF +
              (m.firstIndex / Math.max(1, items.length - 1)) *
                (trackHeight - THUMB_SIZE);
            return (
              <React.Fragment key={m.label}>
                {/* Label — right-aligned, ending with a small gap before the dot */}
                {visibleLabels[idx] && (
                  <div
                    style={{
                      top: midY,
                      right: TRACK_RIGHT + DOT_SIZE / 2 + 6,
                      transform: "translateY(-50%)",
                    }}
                    className="absolute flex items-baseline gap-1 pointer-events-none"
                  >
                    <span className="text-[10px] font-medium leading-none text-zinc-400 whitespace-nowrap">
                      {m.label}
                    </span>
                    <span className="text-[9px] leading-none text-zinc-600 font-medium">
                      {m.count}
                    </span>
                  </div>
                )}

                {/* Dot — centred on the rail at marker y */}
                <div
                  style={{
                    top: midY,
                    right: TRACK_RIGHT - DOT_SIZE / 2,
                    width: DOT_SIZE,
                    height: DOT_SIZE,
                    transform: "translateY(-50%)",
                  }}
                  className="absolute rounded-full bg-zinc-500 pointer-events-none"
                />
              </React.Fragment>
            );
          })}

        {/* Thumb — small circle centred on the rail */}
        <div
          style={{
            top: thumbY - THUMB_HALF,
            right: TRACK_RIGHT - THUMB_HALF,
            width: THUMB_SIZE,
            height: THUMB_SIZE,
          }}
          className={`absolute flex items-center justify-end transition-transform duration-75 ${
            dragging ? "scale-125" : ""
          }`}
        >
          {/* Drag label — appears to the left of the thumb */}
          {dragging && dragLabel ? (
            <div
              style={{ right: THUMB_SIZE + 10 }}
              className="absolute whitespace-nowrap rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-1.5 text-xs font-semibold text-white shadow-xl"
            >
              {dragLabel}
            </div>
          ) : null}

          {/* The circle itself */}
          <div
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            className={`rounded-full border-2 shadow-md ${
              dragging
                ? "border-white bg-white"
                : "border-zinc-300 bg-zinc-300/90"
            }`}
          />
        </div>
      </div>
    </div>
  );
}
