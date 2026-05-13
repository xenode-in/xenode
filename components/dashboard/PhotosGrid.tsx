"use client";

import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { usePreview } from "@/contexts/PreviewContext";
import { Loader2, ImageOff, LayoutGrid, Grid3x3, Rows3 } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { useThumbnail } from "@/hooks/useThumbnail";
import { GridObject, useGridObjects } from "@/hooks/useLazyGallery";
import { Scrubber } from "@/components/dashboard/Scrubber";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GridDensity = "large" | "medium" | "small";

const DENSITY_COLS: Record<GridDensity, string> = {
  large: "grid-cols-2 sm:grid-cols-3",
  medium: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5",
  small: "grid-cols-4 sm:grid-cols-6 md:grid-cols-8",
};

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

function groupByDate(photos: GridObject[]) {
  const groups: Record<string, GridObject[]> = {};
  photos.forEach((p) => {
    const date = new Date(p.createdAt);
    const label = date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    if (!groups[label]) groups[label] = [];
    groups[label].push(p);
  });
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail tile
// ─────────────────────────────────────────────────────────────────────────────

const PhotoThumbnail = memo(function PhotoThumbnail({
  photo,
  onPhotoClick,
  decryptedName,
  metadataKey,
}: {
  photo: GridObject;
  onPhotoClick: (p: GridObject) => void;
  decryptedName?: string;
  metadataKey: CryptoKey | null;
}) {
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (hideTimer !== null) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          setVisible(true);
        } else {
          hideTimer = setTimeout(() => setVisible(false), 150);
        }
      },
      { rootMargin: "400px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (hideTimer !== null) clearTimeout(hideTimer);
    };
  }, []);

  const thumbUrl = useThumbnail(
    visible && photo.thumbnail ? photo.thumbnail : undefined,
    metadataKey,
  );

  return (
    <div
      ref={tileRef}
      onClick={() => onPhotoClick(photo)}
      className="relative w-full rounded-2xl overflow-hidden bg-secondary border border-border/50 cursor-pointer group"
      style={
        photo.aspectRatio && photo.aspectRatio > 0
          ? { aspectRatio: `${photo.aspectRatio}` }
          : { aspectRatio: "1/1" }
      }
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={decryptedName || getFileName(photo.key)}
          decoding="async"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
        />
      ) : (
        <div className="relative w-full h-full overflow-hidden rounded-2xl bg-zinc-900">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300 flex flex-col justify-end">
        <div className="p-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 bg-gradient-to-t from-black/60 via-black/20 to-transparent">
          <p className="text-white text-sm font-medium truncate drop-shadow-md">
            {decryptedName || photo.encryptedName || getFileName(photo.key)}
          </p>
          {photo.size > 0 && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-white/60 text-[10px] uppercase tracking-wider font-bold">
                {formatBytes(photo.size)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Grid layout variants
// ─────────────────────────────────────────────────────────────────────────────

const MasonryGrid = memo(function MasonryGrid({
  photos,
  onPhotoClick,
  decryptedNames,
  metadataKey,
}: {
  photos: GridObject[];
  onPhotoClick: (p: GridObject) => void;
  decryptedNames: Record<string, string>;
  metadataKey: CryptoKey | null;
}) {
  const [columnCount, setColumnCount] = useState(2);

  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth >= 1280) setColumnCount(5);
      else if (window.innerWidth >= 1024) setColumnCount(4);
      else if (window.innerWidth >= 768) setColumnCount(3);
      else setColumnCount(2);
    };

    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const columns = useMemo(() => {
    const cols: GridObject[][] = Array.from({ length: columnCount }, () => []);
    photos.forEach((photo, i) => {
      cols[i % columnCount].push(photo);
    });
    return cols;
  }, [photos, columnCount]);

  return (
    <div className="flex gap-4">
      {columns.map((column, i) => (
        <div key={i} className="flex-1 flex flex-col gap-4">
          {column.map((photo) => (
            <PhotoThumbnail
              key={photo._id}
              photo={photo}
              onPhotoClick={onPhotoClick}
              decryptedName={decryptedNames[photo._id]}
              metadataKey={metadataKey}
            />
          ))}
        </div>
      ))}
    </div>
  );
});

const UniformGrid = memo(function UniformGrid({
  photos,
  density,
  onPhotoClick,
  decryptedNames,
  metadataKey,
}: {
  photos: GridObject[];
  density: GridDensity;
  onPhotoClick: (p: GridObject) => void;
  decryptedNames: Record<string, string>;
  metadataKey: CryptoKey | null;
}) {
  return (
    <div
      className={`grid ${DENSITY_COLS[density]} gap-3 sm:gap-4 auto-rows-[180px] sm:auto-rows-[220px]`}
    >
      {photos.map((photo) => (
        <PhotoThumbnail
          key={photo._id}
          photo={photo}
          onPhotoClick={onPhotoClick}
          decryptedName={decryptedNames[photo._id]}
          metadataKey={metadataKey}
        />
      ))}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function PhotosGrid() {
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [search, setSearch] = useState("");
  const [gridMode, setGridMode] = useState<"masonry" | GridDensity>("masonry");
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );

  const { openPreview } = usePreview();
  const { isUnlocked, metadataKey } = useCrypto();

  // ── Bucket config (one-time fetch) ──────────────────────────────────────────

  useEffect(() => {
    fetch("/api/drive/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.bucket) setBucketId(data.bucket._id);
        else setConfigError("Failed to initialize drive storage");
      })
      .catch(() => setConfigError("Failed to connect to storage"))
      .finally(() => setInitialLoading(false));
  }, []);

  // ── All grid data — one request, no pagination ──────────────────────────────

  const {
    data: gridData,
    isLoading: gridLoading,
    isError: gridError,
  } = useGridObjects(bucketId, { mediaCategory: "image" });

  const allPhotos: GridObject[] = gridData?.items ?? [];

  // ── Name decryption ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isUnlocked || !allPhotos.length) {
      setDecryptedNames((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const run = async () => {
      const newNames: Record<string, string> = {};
      for (const photo of allPhotos) {
        const raw = photo.encryptedDisplayName || photo.encryptedName;
        if (photo.isEncrypted && raw && !decryptedNames[photo._id]) {
          try {
            newNames[photo._id] = await decryptMetadataString(raw, metadataKey);
          } catch {
            // leave encrypted name as-is
          }
        }
      }
      if (Object.keys(newNames).length > 0) {
        setDecryptedNames((prev) => ({ ...prev, ...newNames }));
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPhotos, isUnlocked, metadataKey]);

  // ── Search filter ────────────────────────────────────────────────────────────

  const filteredPhotos = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allPhotos;
    return allPhotos.filter((p) => {
      const name =
        decryptedNames[p._id] || p.encryptedName || getFileName(p.key);
      return name.toLowerCase().includes(query);
    });
  }, [allPhotos, search, decryptedNames]);

  const grouped = useMemo(() => groupByDate(filteredPhotos), [filteredPhotos]);
  const groupEntries = useMemo(() => Object.entries(grouped), [grouped]);

  // ── Scrubber state ────────────────────────────────────────────────────────────

  const [scrollProgress, setScrollProgress] = useState(0);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const groupEntriesRef = useRef<[string, GridObject[]][]>([]);
  groupEntriesRef.current = groupEntries;

  const lastScrubLabelRef = useRef<string | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const sectionOffsetsRef = useRef<
    Array<{ label: string; top: number; firstIndex: number }>
  >([]);

  // Pre-compute index → date label from the full unfiltered list (drives scrubber).
  const metaIndexToLabel = useMemo(
    () =>
      allPhotos.map((item) =>
        new Date(item.createdAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      ),
    [allPhotos],
  );

  // Map date label → first index in allPhotos (for scroll progress calculation).
  const dateLabelToFirstIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < allPhotos.length; i++) {
      const label = new Date(allPhotos[i].createdAt).toLocaleDateString(
        "en-US",
        { month: "long", day: "numeric", year: "numeric" },
      );
      if (!map.has(label)) map.set(label, i);
    }
    return map;
  }, [allPhotos]);

  // Rebuild offsetTop cache after DOM layout.
  const measureOffsets = useCallback(() => {
    const result: typeof sectionOffsetsRef.current = [];
    for (const [label] of groupEntriesRef.current) {
      const el = groupRefs.current[label];
      if (!el) continue;
      result.push({
        label,
        top: el.offsetTop,
        firstIndex: dateLabelToFirstIndex.get(label) ?? 0,
      });
    }
    sectionOffsetsRef.current = result;
  }, [dateLabelToFirstIndex]);

  useEffect(() => {
    const id = requestAnimationFrame(measureOffsets);
    return () => cancelAnimationFrame(id);
  }, [measureOffsets, groupEntries]);

  useEffect(() => {
    window.addEventListener("resize", measureOffsets, { passive: true });
    return () => window.removeEventListener("resize", measureOffsets);
  }, [measureOffsets]);

  // RAF-gated binary-search scroll handler.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const offsets = sectionOffsetsRef.current;
      if (offsets.length === 0 || allPhotos.length === 0) return;

      const THRESHOLD = 76;
      const scrollY = window.scrollY;
      let lo = 0,
        hi = offsets.length - 1,
        activeIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid].top <= scrollY + THRESHOLD) {
          activeIdx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }

      if (activeIdx === -1) {
        setScrollProgress(0);
        lastScrubLabelRef.current = null;
        return;
      }

      const { label, firstIndex } = offsets[activeIdx];
      if (label === lastScrubLabelRef.current) return;
      lastScrubLabelRef.current = label;
      setScrollProgress(firstIndex / Math.max(1, allPhotos.length - 1));
    });
  }, [allPhotos.length]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Scrub: instant jump to section.
  const handleScrub = useCallback(
    (index: number) => {
      const label = metaIndexToLabel[index];
      if (!label || label === lastScrubLabelRef.current) return;
      lastScrubLabelRef.current = label;
      groupRefs.current[label]?.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
    },
    [metaIndexToLabel],
  );

  // ── Photo click ──────────────────────────────────────────────────────────────

  const filteredPhotosRef = useRef<GridObject[]>([]);
  filteredPhotosRef.current = filteredPhotos;

  const handlePhotoClick = useCallback(
    (photo: GridObject) => {
      // PreviewContext / FilePreviewDialog reads `.id` (not `._id`).
      // GridObject comes from /api/objects/grid which returns `_id`.
      // Bridge the gap by spreading `id` alongside the existing fields.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const asLegacy = (p: GridObject) => ({ ...p, id: p._id }) as any;
      openPreview(asLegacy(photo), filteredPhotosRef.current.map(asLegacy));
    },
    [openPreview],
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-start">
      {/* Gallery content */}
      <div className="grow min-w-0">
        <div className="space-y-6 pb-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Photos</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {filteredPhotos.length} image
                {filteredPhotos.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative group/search">
                <input
                  type="text"
                  placeholder="Search Photos"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 pl-10 pr-4 rounded-xl bg-secondary/50 backdrop-blur-md border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all w-48 sm:w-64"
                />
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/30 group-focus-within/search:text-primary/60 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>

              {/* Grid density toggle */}
              <div className="flex items-center bg-secondary/30 backdrop-blur-md rounded-xl p-1 border border-border/50">
                {(["masonry", "large", "medium", "small"] as const).map(
                  (mode) => {
                    const icons: Record<string, React.ReactNode> = {
                      masonry: <LayoutGrid className="w-3.5 h-3.5" />,
                      large: <Rows3 className="w-3.5 h-3.5" />,
                      medium: <Grid3x3 className="w-3.5 h-3.5" />,
                      small: <LayoutGrid className="w-3 h-3" />,
                    };
                    return (
                      <button
                        key={mode}
                        onClick={() => setGridMode(mode)}
                        className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                          gridMode === mode
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground/40 hover:text-foreground"
                        }`}
                      >
                        {icons[mode]}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>

          {/* Config error */}
          {configError && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              {configError}
            </div>
          )}

          {/* Grid loading */}
          {gridLoading && (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}

          {/* Grid error */}
          {gridError && !gridLoading && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              Failed to load photos
            </div>
          )}

          {/* Empty */}
          {!gridLoading && !gridError && filteredPhotos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-center animate-in fade-in slide-in-from-bottom-4 duration-1000">
              <div className="relative mb-6">
                <div className="w-24 h-24 rounded-3xl bg-primary/5 border border-primary/10 flex items-center justify-center rotate-6 scale-110">
                  <ImageOff className="w-10 h-10 text-primary/20 -rotate-6" />
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center shadow-lg">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">
                {search ? "No matches found" : "Your gallery is empty"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-8">
                {search
                  ? "We couldn't find any photos matching your search."
                  : "Start building your visual library by uploading images to your vault."}
              </p>
              {!search && (
                <a
                  href="/dashboard/files"
                  className="inline-flex items-center justify-center px-6 h-11 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0"
                >
                  Upload First Photo
                </a>
              )}
            </div>
          )}

          {/* Photo groups — all rendered at once; IO on each tile gates thumbnail fetch */}
          {groupEntries.map(([dateLabel, groupPhotos]) => (
            <div
              key={dateLabel}
              ref={(el) => {
                groupRefs.current[dateLabel] = el;
              }}
              className="space-y-4 scroll-mt-[76px]"
            >
              <div className="sticky top-[68px] z-30 py-2 -mx-4 px-4 bg-background/80 backdrop-blur-md border-b border-border/0 data-stuck:border-border/50 transition-colors">
                <p className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                  {dateLabel}
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-bold ml-auto">
                    {groupPhotos.length} item
                    {groupPhotos.length !== 1 ? "s" : ""}
                  </span>
                </p>
              </div>
              {gridMode === "masonry" ? (
                <MasonryGrid
                  photos={groupPhotos}
                  onPhotoClick={handlePhotoClick}
                  decryptedNames={decryptedNames}
                  metadataKey={metadataKey}
                />
              ) : (
                <UniformGrid
                  photos={groupPhotos}
                  density={gridMode as GridDensity}
                  onPhotoClick={handlePhotoClick}
                  decryptedNames={decryptedNames}
                  metadataKey={metadataKey}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline scrubber */}
      {allPhotos.length > 0 && (
        <div className="sticky top-[68px] h-[calc(100dvh-68px)] shrink-0">
          <Scrubber
            items={allPhotos}
            scrollProgress={scrollProgress}
            onScrub={handleScrub}
          />
        </div>
      )}
    </div>
  );
}
