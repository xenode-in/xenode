"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { usePreview } from "@/contexts/PreviewContext";
import { Loader2, ImageOff, LayoutGrid, Grid3x3, Rows3 } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { useThumbnail } from "@/hooks/useThumbnail";

import { useSession } from "@/lib/auth/client";
import { useFileSync } from "@/hooks/useFileSync";
import { useObjectsMetadata } from "@/hooks/useLazyGallery";
import { getDb } from "@/lib/db/local";
import { useLiveQuery } from "dexie-react-hooks";
import { motion, AnimatePresence } from "framer-motion";
import { Scrubber } from "@/components/dashboard/Scrubber";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  thumbnail?: string;
  isEncrypted?: boolean;
  tags?: string[];
  position?: number;
  encryptedName?: string;
  encryptedDisplayName?: string;
  optimizedKey?: string;
  optimizedIV?: string;
  optimizedEncryptedDEK?: string;
  optimizedSize?: number;
  aspectRatio?: number;
}

type GridDensity = "large" | "medium" | "small";

const DENSITY_COLS: Record<GridDensity, string> = {
  large: "grid-cols-2 sm:grid-cols-3",
  medium: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5",
  small: "grid-cols-4 sm:grid-cols-6 md:grid-cols-8",
};

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

function groupByDate(photos: ObjectData[]) {
  const groups: Record<string, ObjectData[]> = {};
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

function PhotoThumbnail({
  photo,
  onPhotoClick,
  decryptedName,
  metadataKey,
}: {
  photo: ObjectData;
  onPhotoClick: (p: ObjectData) => void;
  decryptedName?: string;
  metadataKey: CryptoKey | null;
}) {
  const thumbUrl = useThumbnail(photo.thumbnail, metadataKey);

  return (
    <div
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
        <div className="w-full h-full flex items-center justify-center bg-secondary/50">
          <ImageOff className="w-8 h-8 text-muted-foreground/20" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300 flex flex-col justify-end">
        <div className="p-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 bg-gradient-to-t from-black/60 via-black/20 to-transparent">
          <p className="text-white text-sm font-medium truncate drop-shadow-md">
            {decryptedName || photo.encryptedName || getFileName(photo.key)}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-white/60 text-[10px] uppercase tracking-wider font-bold">
              {formatBytes(photo.size)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MasonryGrid({
  photos,
  onPhotoClick,
  decryptedNames,
  metadataKey,
}: {
  photos: ObjectData[];
  onPhotoClick: (p: ObjectData) => void;
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
    const cols: ObjectData[][] = Array.from({ length: columnCount }, () => []);
    photos.forEach((photo, i) => {
      cols[i % columnCount].push(photo);
    });
    return cols;
  }, [photos, columnCount]);

  return (
    <div className="flex gap-4">
      {columns.map((column, i) => (
        <div key={i} className="flex-1 flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {column.map((photo) => (
              <motion.div
                key={photo.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              >
                <PhotoThumbnail
                  photo={photo}
                  onPhotoClick={onPhotoClick}
                  decryptedName={decryptedNames[photo.id]}
                  metadataKey={metadataKey}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function UniformGrid({
  photos,
  density,
  onPhotoClick,
  decryptedNames,
  metadataKey,
}: {
  photos: ObjectData[];
  density: GridDensity;
  onPhotoClick: (p: ObjectData) => void;
  decryptedNames: Record<string, string>;
  metadataKey: CryptoKey | null;
}) {
  return (
    <div
      className={`grid ${DENSITY_COLS[density]} gap-3 sm:gap-4 auto-rows-[180px] sm:auto-rows-[220px]`}
    >
      {photos.map((photo) => (
        <PhotoThumbnail
          key={photo.id}
          photo={photo}
          onPhotoClick={onPhotoClick}
          decryptedName={decryptedNames[photo.id]}
          metadataKey={metadataKey}
        />
      ))}
    </div>
  );
}

export function PhotosGrid() {
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [gridMode, setGridMode] = useState<"masonry" | GridDensity>("masonry");
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );

  const { openPreview } = usePreview();
  const { isUnlocked, metadataKey } = useCrypto();
  const { data: session } = useSession();
  const userId = session?.user?.id || null;

  // Gallery wrapper ref (used only for bounding-box reads, no overflow scroll)
  const galleryRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Refs to each date-group section so onScrub can jump to them
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetch("/api/drive/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.bucket) {
          setBucketId(data.bucket._id);
        } else {
          setError("Failed to initialize drive storage");
        }
      })
      .catch(() => setError("Failed to connect to storage"))
      .finally(() => setInitialLoading(false));
  }, []);

  const {
    fetchNextPage: fetchNextBatch,
    hasNextPage: hasMorePages,
    isFetchingNextPage: loadingMore,
  } = useFileSync({
    bucketId,
    userId,
    limit: 50,
  });

  // Lightweight metadata for the scrubber timeline (dates + counts).
  // Does not affect gallery display — gallery still uses Dexie local cache.
  const { data: metaData } = useObjectsMetadata(bucketId, {
    mediaCategory: "image",
  });
  const metadataItems = metaData?.items ?? [];

  // Map each date label (same format as groupByDate) → first index in metadataItems.
  // This lets handleScroll translate "which section is visible" into a 0-1 progress
  // value that matches the scrubber's photo-count coordinate system.
  const dateLabelToFirstMetaIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < metadataItems.length; i++) {
      const label = new Date(metadataItems[i].createdAt).toLocaleDateString(
        "en-US",
        { month: "long", day: "numeric", year: "numeric" },
      );
      if (!map.has(label)) map.set(label, i);
    }
    return map;
  }, [metadataItems]);

  // Keep a stable ref to the current groupEntries so handleScroll never
  // needs it as a dep (avoids re-registering the window listener every render).
  const groupEntriesRef = useRef<[string, ObjectData[]][]>([]);

  // Tracks the last date section the scrubber jumped to; prevents re-firing
  // scrollIntoView on every pointer-move event within the same section.
  const lastScrubLabelRef = useRef<string | null>(null);

  // Section-aware scroll progress: find which date-group header is closest to
  // the top of the viewport, then map its first metadata index to 0-1.
  const handleScroll = useCallback(() => {
    const entries = groupEntriesRef.current;
    if (entries.length === 0 || metadataItems.length === 0) return;

    // Groups are newest-first. Walk through them and keep the last one whose
    // header has scrolled above the viewport threshold.
    // 76 = topbar (68 px) + 8 px breathing room, matching scroll-mt-[76px].
    const THRESHOLD = 76;
    let activeLabel: string | null = null;
    for (const [label] of entries) {
      const el = groupRefs.current[label];
      if (!el) continue;
      if (el.getBoundingClientRect().top <= THRESHOLD) {
        activeLabel = label;
      } else {
        break; // below threshold — groups further down won't qualify either
      }
    }

    if (activeLabel === null) {
      setScrollProgress(0);
      lastScrubLabelRef.current = null;
      return;
    }
    const idx = dateLabelToFirstMetaIndex.get(activeLabel) ?? 0;
    setScrollProgress(idx / Math.max(1, metadataItems.length - 1));
    // Keep lastScrubLabel in sync with actual scroll position so the next
    // drag to this same section (after manual scrolling away and back) fires.
    lastScrubLabelRef.current = activeLabel;
  }, [metadataItems, dateLabelToFirstMetaIndex]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // initialise on mount
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const localFiles =
    useLiveQuery(() => {
      if (!userId || !bucketId) return [];
      const db = getDb(userId);
      return db.files.where("bucketId").equals(bucketId).toArray();
    }, [userId, bucketId]) || [];

  const photos = useMemo(() => {
    return localFiles
      .filter(
        (f) =>
          f.contentType?.startsWith("image/") || f.mediaCategory === "image",
      )
      .map((f) => ({ ...f, _id: f.id }) as unknown as ObjectData)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [localFiles]);

  useEffect(() => {
    if (!isUnlocked || !photos.length) {
      setDecryptedNames((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const decryptMetadata = async () => {
      const newNames: Record<string, string> = {};

      for (const photo of photos) {
        const nameToDecrypt = photo.encryptedDisplayName || photo.encryptedName;
        if (photo.isEncrypted && nameToDecrypt && !decryptedNames[photo.id]) {
          try {
            const name = await decryptMetadataString(
              nameToDecrypt,
              metadataKey,
            );
            newNames[photo.id] = name;
          } catch (e) {
            console.error("Failed to decrypt name", e);
          }
        }
      }

      if (Object.keys(newNames).length > 0) {
        setDecryptedNames((prev) => ({ ...prev, ...newNames }));
      }
    };

    decryptMetadata();
  }, [photos, isUnlocked, metadataKey, decryptedNames]);

  // Scrub handler: map metadata index → date label → instant-scroll to section.
  // Using behavior:"instant" is critical — smooth scroll queued 60×/sec from
  // pointer move events fight each other and the page never lands anywhere.
  const handleScrub = useCallback(
    (index: number) => {
      const iso = metadataItems[index]?.createdAt;
      if (!iso) return;
      const label = new Date(iso).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      if (label === lastScrubLabelRef.current) return; // already at this section
      lastScrubLabelRef.current = label;
      groupRefs.current[label]?.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
    },
    [metadataItems],
  );

  // ⚡ INFINITE SCROLL OBSERVER LOGIC
  const observer = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loadingMore) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(
        (entries) => {
          // If the invisible div intersects the viewport and we have more pages, fetch!
          if (entries[0].isIntersecting && hasMorePages) {
            fetchNextBatch();
          }
        },
        // Trigger the fetch when the user is 400px away from the bottom for a seamless experience
        { rootMargin: "400px" },
      );

      if (node) observer.current.observe(node);
    },
    [loadingMore, hasMorePages, fetchNextBatch],
  );

  const filteredPhotos = search.trim()
    ? photos.filter((p) => {
        const name =
          decryptedNames[p.id] || p.encryptedName || getFileName(p.key);
        return name.toLowerCase().includes(search.toLowerCase());
      })
    : photos;

  const grouped = groupByDate(filteredPhotos);
  const groupEntries = Object.entries(grouped);
  // Keep the ref current so handleScroll always reads the latest entries
  // without needing groupEntries in its own dep array.
  groupEntriesRef.current = groupEntries;

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-start">
      {/* Gallery content — scrolls with the page */}
      <div ref={galleryRef} className="grow min-w-0">
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

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Empty */}
          {filteredPhotos.length === 0 && !error && (
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
                  ? "We couldn't find any photos matching your search. Try different keywords."
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

          {/* Photo Groups */}
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
                  onPhotoClick={(photo) => openPreview(photo, filteredPhotos)}
                  decryptedNames={decryptedNames}
                  metadataKey={metadataKey}
                />
              ) : (
                <UniformGrid
                  photos={groupPhotos}
                  density={gridMode as GridDensity}
                  onPhotoClick={(photo) => openPreview(photo, filteredPhotos)}
                  decryptedNames={decryptedNames}
                  metadataKey={metadataKey}
                />
              )}
            </div>
          ))}

          {/* ⚡ The Infinite Scroll Sentinel */}
          {hasMorePages && (
            <div
              ref={lastElementRef}
              className="flex justify-center pt-8 pb-8 w-full"
            >
              {loadingMore && (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Timeline scrubber — sticky below the topbar (68 px) on the right */}
      {metadataItems.length > 0 && (
        <div className="sticky top-[68px] h-[calc(100dvh-68px)] shrink-0">
          <Scrubber
            items={metadataItems}
            scrollProgress={scrollProgress}
            onScrub={handleScrub}
          />
        </div>
      )}
    </div>
  );
}
