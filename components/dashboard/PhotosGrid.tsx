"use client";

import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { usePreview } from "@/contexts/PreviewContext";
import { Loader2, ImageOff, LayoutGrid, Grid3x3, Rows3 } from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { useThumbnail } from "@/hooks/useThumbnail";
import { GridObject, useGridObjects } from "@/hooks/useLazyGallery";
import { Scrubber } from "@/components/dashboard/Scrubber";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GridDensity = "large" | "medium" | "small";

function getColumnCount(mode: "masonry" | GridDensity, width: number): number {
  if (mode === "masonry") {
    if (width >= 1280) return 5;
    if (width >= 1024) return 4;
    if (width >= 768) return 3;
    return 2;
  }
  if (mode === "large") {
    if (width >= 640) return 3;
    return 2;
  }
  if (mode === "medium") {
    if (width >= 768) return 5;
    if (width >= 640) return 4;
    return 3;
  }
  if (mode === "small") {
    if (width >= 768) return 8;
    if (width >= 640) return 6;
    return 4;
  }
  return 4;
}

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

// Grids inline virtualized

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
  const scrubberItems = filteredPhotos;

  // ── Scrubber state ────────────────────────────────────────────────────────────

  // ── Scrubber & Virtualization State ─────────────────────────────────────────

  const [scrollProgress, setScrollProgress] = useState(0);
  const galleryContainerRef = useRef<HTMLDivElement | null>(null);
  const [windowWidth, setWindowWidth] = useState<number>(0);

  useEffect(() => {
    setWindowWidth(window.innerWidth);
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const columnCount = useMemo(() => {
    if (windowWidth === 0) return 4;
    return getColumnCount(gridMode, windowWidth);
  }, [gridMode, windowWidth]);

  const { virtualItemsData, labelToVirtualIndex, photoIndexToVirtualIndex } = useMemo(() => {
    const data: Array<
      | { type: "header"; dateLabel: string; count: number; photoIndex: number }
      | { type: "grid"; photos: GridObject[]; dateLabel: string; photoIndex: number }
    > = [];
    const labelToIndex: Record<string, number> = {};
    const photoToVirtual: number[] = [];

    let runningPhotoIndex = 0;
    groupEntries.forEach(([dateLabel, groupPhotos]) => {
      // 1. Add header
      const headerIndex = data.length;
      data.push({
        type: "header",
        dateLabel,
        count: groupPhotos.length,
        photoIndex: runningPhotoIndex,
      });
      labelToIndex[dateLabel] = headerIndex;

      // 2. Add grid
      const gridIndex = data.length;
      data.push({
        type: "grid",
        photos: groupPhotos,
        dateLabel,
        photoIndex: runningPhotoIndex,
      });

      groupPhotos.forEach(() => {
        photoToVirtual.push(headerIndex);
      });

      runningPhotoIndex += groupPhotos.length;
    });

    return {
      virtualItemsData: data,
      labelToVirtualIndex: labelToIndex,
      photoIndexToVirtualIndex: photoToVirtual,
    };
  }, [groupEntries]);

  const photoContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const updateMargin = () => {
      if (photoContainerRef.current) {
        const rect = photoContainerRef.current.getBoundingClientRect();
        setScrollMargin(rect.top + window.scrollY);
      }
    };
    updateMargin();
    const timer = setTimeout(updateMargin, 150);
    window.addEventListener("resize", updateMargin);
    window.addEventListener("scroll", updateMargin);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateMargin);
      window.removeEventListener("scroll", updateMargin);
    };
  }, [filteredPhotos.length, gridLoading, gridError]);

  const virtualizer = useWindowVirtualizer({
    count: virtualItemsData.length,
    estimateSize: (index) => {
      const item = virtualItemsData[index];
      if (!item) return 200;
      if (item.type === "header") return 50;
      const rowsCount = Math.ceil(item.photos.length / columnCount);
      return rowsCount * 220;
    },
    scrollMargin,
    overscan: 3,
  });

  const firstVisibleIndex = useMemo(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return 0;
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    // Finding the first item that is visible below the 68px top-bar
    const activeItem = items.find((item) => item.end > scrollOffset + 68);
    return activeItem?.index ?? items[0].index;
  }, [virtualizer, virtualizer.scrollOffset]);

  useEffect(() => {
    const item = virtualItemsData[firstVisibleIndex];
    if (!item) return;
    const progress = item.photoIndex / Math.max(1, filteredPhotos.length - 1);
    setScrollProgress(progress);
  }, [firstVisibleIndex, virtualItemsData, filteredPhotos.length]);

  const currentDateLabel = useMemo(() => {
    const item = virtualItemsData[firstVisibleIndex];
    return item?.dateLabel ?? "";
  }, [firstVisibleIndex, virtualItemsData]);

  const handleScrub = useCallback(
    (index: number) => {
      const vIdx = photoIndexToVirtualIndex[index];
      if (vIdx !== undefined) {
        setScrollProgress(index / Math.max(1, scrubberItems.length - 1));
        virtualizer.scrollToIndex(vIdx, { align: "start" });
      }
    },
    [photoIndexToVirtualIndex, virtualizer, scrubberItems.length],
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
        <div ref={galleryContainerRef} className="space-y-6 pb-8">
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

          {/* Floating Glassmorphism Sticky Date Header */}
          {currentDateLabel && (
            <div className="sticky top-[68px] z-30 py-2 -mx-4 px-4 bg-background/80 backdrop-blur-md border-b border-border/10 transition-colors">
              <p className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse" />
                {currentDateLabel}
              </p>
            </div>
          )}

          {/* Virtualized photo container */}
          {!gridLoading && !gridError && filteredPhotos.length > 0 && (
            <div
              ref={photoContainerRef}
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = virtualItemsData[virtualRow.index];
                if (!item) return null;

                if (item.type === "header") {
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                      }}
                      className="py-2 px-4 border-b border-border/5"
                    >
                      <p className="text-sm font-semibold text-foreground/50 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                        {item.dateLabel}
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-bold ml-auto">
                          {item.count} item{item.count !== 1 ? "s" : ""}
                        </span>
                      </p>
                    </div>
                  );
                }

                // Masonry columns distribution
                if (gridMode === "masonry") {
                  const columns: GridObject[][] = Array.from({ length: columnCount }, () => []);
                  item.photos.forEach((photo, i) => {
                    columns[i % columnCount].push(photo);
                  });

                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                      }}
                      className="flex gap-4 px-4 py-2"
                    >
                      {columns.map((column, i) => (
                        <div key={i} className="flex-1 flex flex-col gap-4">
                          {column.map((photo) => (
                            <PhotoThumbnail
                              key={photo._id}
                              photo={photo}
                              onPhotoClick={handlePhotoClick}
                              decryptedName={decryptedNames[photo._id]}
                              metadataKey={metadataKey}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                }

                // Uniform Grid rows layout
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                    }}
                    className={cn(
                      "grid gap-3 sm:gap-4 px-4 py-2",
                      gridMode === "large" && "grid-cols-2 sm:grid-cols-3 auto-rows-[180px] sm:auto-rows-[220px]",
                      gridMode === "medium" && "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 auto-rows-[180px] sm:auto-rows-[220px]",
                      gridMode === "small" && "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 auto-rows-[180px] sm:auto-rows-[220px]"
                    )}
                  >
                    {item.photos.map((photo) => (
                      <PhotoThumbnail
                        key={photo._id}
                        photo={photo}
                        onPhotoClick={handlePhotoClick}
                        decryptedName={decryptedNames[photo._id]}
                        metadataKey={metadataKey}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Timeline scrubber */}
      {scrubberItems.length > 0 && (
        <div className="sticky top-[68px] h-[calc(100dvh-68px)] shrink-0">
          <Scrubber
            items={scrubberItems}
            scrollProgress={scrollProgress}
            onScrub={handleScrub}
          />
        </div>
      )}
    </div>
  );
}
