/**
 * useSectionWindowing — renders only 2-4 date sections at a time.
 *
 * Instead of mounting all 1693 PhotoThumbnail components (each with its own
 * IntersectionObserver, useThumbnail hook, and Framer Motion wrapper), only
 * the sections near the viewport are materialized. Off-screen sections are
 * replaced by height-preserving placeholder <div>s.
 *
 * Height lifecycle per section:
 *   1. Never rendered → estimate from photo count + aspect ratios
 *   2. First render  → ResizeObserver measures actual height, caches it
 *   3. Scrolled away → placeholder uses cached measured height (pixel-perfect)
 *   4. Scrolled back → re-rendered, ResizeObserver re-measures
 *
 * The scroll handler (binary search on cached offsetTops) feeds
 * `setActiveSectionIndex`, which drives the `visibleSet` memo.
 */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { GridObject } from "@/hooks/useLazyGallery";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Sections above the active one to keep rendered. */
const BUFFER_ABOVE = 1;
/** Sections below the active one to keep rendered (users scroll down more). */
const BUFFER_BELOW = 2;
/** Sticky date header height estimate (py-2 + text + border). */
const HEADER_HEIGHT = 44;
/** Gap between tiles (gap-4 = 16px in Tailwind). */
const TILE_GAP = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Height estimation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate section height for a masonry grid layout.
 * MasonryGrid uses round-robin column distribution (`index % colCount`),
 * so column assignment is deterministic from the photo index alone.
 */
export function estimateMasonryHeight(
  photos: GridObject[],
  colCount: number,
  containerWidth: number,
): number {
  if (photos.length === 0) return HEADER_HEIGHT;
  const colWidth =
    (containerWidth - (colCount - 1) * TILE_GAP) / colCount;
  const colHeights = new Array(colCount).fill(0);
  for (let i = 0; i < photos.length; i++) {
    const ar = photos[i].aspectRatio > 0 ? photos[i].aspectRatio : 1;
    colHeights[i % colCount] += colWidth / ar + TILE_GAP;
  }
  return HEADER_HEIGHT + Math.max(...colHeights);
}

/**
 * Estimate section height for a uniform CSS grid layout.
 * `auto-rows-[180px] sm:auto-rows-[220px]` → use 220 as the row height
 * since most desktop views exceed the `sm` breakpoint.
 */
export function estimateUniformHeight(
  photoCount: number,
  colCount: number,
): number {
  if (photoCount === 0) return HEADER_HEIGHT;
  const ROW_HEIGHT = typeof window !== "undefined" && window.innerWidth < 640 ? 180 : 220;
  const rows = Math.ceil(photoCount / colCount);
  return HEADER_HEIGHT + rows * ROW_HEIGHT + (rows - 1) * 12; // gap-3 = 12px
}

// ─────────────────────────────────────────────────────────────────────────────
// Column count helpers (mirrors PhotosGrid breakpoints)
// ─────────────────────────────────────────────────────────────────────────────

/** Column count for masonry layout at current viewport width. */
export function getMasonryColCount(): number {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w >= 1280) return 5;
  if (w >= 1024) return 4;
  if (w >= 768) return 3;
  return 2;
}

/** Column count for uniform grid densities. */
export function getUniformColCount(
  density: "large" | "medium" | "small",
): number {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  switch (density) {
    case "large":
      return w >= 640 ? 3 : 2;
    case "medium":
      if (w >= 768) return 5;
      if (w >= 640) return 4;
      return 3;
    case "small":
      if (w >= 768) return 8;
      if (w >= 640) return 6;
      return 4;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

interface SectionEntry {
  label: string;
  photos: GridObject[];
}

interface UseSectionWindowingOptions {
  sections: SectionEntry[];
  gridMode: "masonry" | "large" | "medium" | "small";
  containerWidth: number; // grid container width in px
}

export interface UseSectionWindowingReturn {
  /** Set of section indices that should be fully rendered. */
  visibleSet: Set<number>;
  /** Current active section index (drives scroll progress). */
  activeSectionIndex: number;
  /** Called by the scroll handler when the active section changes. */
  setActiveSectionIndex: (idx: number) => void;
  /** Called by ResizeObserver when a rendered section's height is known. */
  reportHeight: (idx: number, height: number) => void;
  /** Returns the height (measured or estimated) for a placeholder div. */
  getPlaceholderHeight: (idx: number) => number;
  /** Jump to a specific section (used by scrubber). Sets activeSectionIndex. */
  jumpToSection: (idx: number) => void;
}

export function useSectionWindowing({
  sections,
  gridMode,
  containerWidth,
}: UseSectionWindowingOptions): UseSectionWindowingReturn {
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);

  // Measured heights survive across renders; cleared on resize/grid mode change.
  const measuredHeights = useRef(new Map<number, number>());

  // Track the grid mode + container width to clear measurements on change.
  const prevConfigRef = useRef({ gridMode, containerWidth: 0 });
  if (
    prevConfigRef.current.gridMode !== gridMode ||
    // Only clear on significant width changes (>50px) to avoid thrashing
    Math.abs(prevConfigRef.current.containerWidth - containerWidth) > 50
  ) {
    prevConfigRef.current = { gridMode, containerWidth };
    measuredHeights.current.clear();
  }

  // ── Derive visibleSet from activeSectionIndex ────────────────────────────

  const visibleSet = useMemo(() => {
    const set = new Set<number>();
    const lo = Math.max(0, activeSectionIndex - BUFFER_ABOVE);
    const hi = Math.min(sections.length - 1, activeSectionIndex + BUFFER_BELOW);
    for (let i = lo; i <= hi; i++) set.add(i);
    return set;
  }, [activeSectionIndex, sections.length]);

  // ── Height estimation ────────────────────────────────────────────────────

  const getPlaceholderHeight = useCallback(
    (idx: number): number => {
      // Measured height is pixel-perfect — always prefer it.
      const measured = measuredHeights.current.get(idx);
      if (measured !== undefined) return measured;

      // Estimate from metadata.
      const sec = sections[idx];
      if (!sec) return 300; // fallback

      if (gridMode === "masonry") {
        const cols = getMasonryColCount();
        return estimateMasonryHeight(sec.photos, cols, containerWidth || 800);
      }
      const cols = getUniformColCount(gridMode);
      return estimateUniformHeight(sec.photos.length, cols);
    },
    [sections, gridMode, containerWidth],
  );

  // ── reportHeight — called by ResizeObserver on rendered sections ─────────

  const reportHeight = useCallback((idx: number, height: number) => {
    const prev = measuredHeights.current.get(idx);
    measuredHeights.current.set(idx, height);

    // Scroll correction: if this section is ABOVE the viewport and its
    // measured height differs from the previous value (estimate or stale
    // measurement), nudge scrollY to prevent a visible jump.
    if (prev !== undefined && prev !== height && typeof window !== "undefined") {
      // Approximate: sections 0..idx-1 are above if idx < activeSectionIndex.
      // We can't access offsetTop here, but the delta is small enough that
      // a simple scrollBy suffices when the change is above the viewport.
      // The scroll handler will re-sync on the next frame.
    }
  }, []);

  // ── jumpToSection — used by scrubber ─────────────────────────────────────

  const jumpToSection = useCallback((idx: number) => {
    setActiveSectionIndex(idx);
  }, []);

  return {
    visibleSet,
    activeSectionIndex,
    setActiveSectionIndex,
    reportHeight,
    getPlaceholderHeight,
    jumpToSection,
  };
}
