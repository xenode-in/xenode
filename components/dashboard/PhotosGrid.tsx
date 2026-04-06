"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { usePreview } from "@/contexts/PreviewContext";
import { Loader2, ImageOff, LayoutGrid, Grid3x3, Rows3 } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptMetadataString,
  decryptFile,
} from "@/lib/crypto/fileEncryption";
import { useThumbnail } from "@/hooks/useThumbnail";

import { useSession } from "@/lib/auth/client";
import { useFileSync } from "@/hooks/useFileSync";
import { getDb } from "@/lib/db/local";
import { useLiveQuery } from "dexie-react-hooks";
import { motion, AnimatePresence } from "framer-motion";

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
  privateKey,
  className = "",
}: {
  photo: ObjectData;
  onPhotoClick: (p: ObjectData) => void;
  decryptedName?: string;
  metadataKey: CryptoKey | null;
  privateKey: CryptoKey | null;
  className?: string;
}) {
  const [optimizedUrl, setOptimizedUrl] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [loadingOptimized, setLoadingOptimized] = useState(false);
  const [failed, setFailed] = useState(false);
  const thumbUrl = useThumbnail(photo.thumbnail, metadataKey);

  const observerRef = useRef<HTMLDivElement>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const loadedForId = useRef<string | null>(null);

  useEffect(() => {
    const current = observerRef.current;
    if (!current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasBeenVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(current);
    return () => obs.disconnect();
  }, []);

  // Quick debug — add this temporarily
  useEffect(() => {
    if (hasBeenVisible) {
      console.log("[Debug] photo fields:", {
        id: photo.id,
        optimizedKey: photo.optimizedKey,
        optimizedEncryptedDEK: photo.optimizedEncryptedDEK,
        optimizedIV: photo.optimizedIV,
        aspectRatio: photo.aspectRatio,
      });
    }
  }, [hasBeenVisible]);

  useEffect(() => {
    // Skip if not visible, no keys, no optimized version, already loaded, or failed
    if (
      !hasBeenVisible ||
      !metadataKey ||
      !privateKey ||
      !photo.optimizedKey ||
      failed ||
      loadedForId.current === photo.id
    )
      return;

    let cancelled = false;

    const load = async () => {
      setLoadingOptimized(true);
      try {
        const res = await fetch(`/api/objects/${photo.id}?preview=true`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Must have encrypted DEK and IV to decrypt
        if (!data.encryptedDEK || !data.iv) {
          throw new Error("Missing decryption params");
        }

        const fileRes = await fetch(data.url);
        if (!fileRes.ok)
          throw new Error(`File fetch failed: ${fileRes.status}`);
        const ciphertext = await fileRes.arrayBuffer();

        // Preview is always WebP — don't trust data.contentType
        // which will be "application/octet-stream" for encrypted files
        const blob = await decryptFile(
          ciphertext,
          data.encryptedDEK,
          data.iv,
          privateKey,
          "image/webp",
        );

        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          setOptimizedUrl(url);
          loadedForId.current = photo.id;
        }
      } catch (err) {
        console.error(
          `[PhotoThumbnail] Failed to load optimized for ${photo.id}:`,
          err,
        );
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoadingOptimized(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [
    hasBeenVisible,
    photo.id,
    photo.optimizedKey,
    metadataKey,
    privateKey,
    failed,
  ]);

  useEffect(() => {
    // Only run if no optimizedKey and we're visible
    if (!hasBeenVisible || photo.optimizedKey || !metadataKey || failed) return;
    if (photo.isEncrypted && !privateKey) return;

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/objects/${photo.id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const fileRes = await fetch(data.url);
        if (!fileRes.ok) throw new Error(`File fetch failed: ${fileRes.status}`);
        const ciphertext = await fileRes.arrayBuffer();

        let blob: Blob;

        if (photo.isEncrypted && data.encryptedDEK && data.iv && privateKey) {
          blob = await decryptFile(
            ciphertext,
            data.encryptedDEK,
            data.iv,
            privateKey,
            photo.contentType || "image/png",
          );
        } else {
          blob = new Blob([ciphertext], {
            type: photo.contentType || "image/png",
          });
        }

        if (!cancelled) {
          setRawUrl(URL.createObjectURL(blob));
        }
      } catch (err) {
        console.error(
          `[PhotoThumbnail] Failed to load raw file for ${photo.id}:`,
          err,
        );
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [
    hasBeenVisible,
    photo.id,
    photo.optimizedKey,
    photo.isEncrypted,
    metadataKey,
    privateKey,
    failed,
  ]);

  // Cleanup blob URLs on unmount or when urls change
  useEffect(() => {
    return () => {
      if (optimizedUrl) URL.revokeObjectURL(optimizedUrl);
    };
  }, [optimizedUrl]);

  useEffect(() => {
    return () => {
      if (rawUrl) URL.revokeObjectURL(rawUrl);
    };
  }, [rawUrl]);

  const displayUrl = optimizedUrl || rawUrl || thumbUrl;
  const isReady = !!optimizedUrl || !!rawUrl;

  return (
    <div
      ref={observerRef}
      onClick={() => onPhotoClick(photo)}
      className={`relative w-full rounded-2xl overflow-hidden bg-secondary border border-border/50 cursor-pointer group ${className}`}
      style={
        photo.aspectRatio && photo.aspectRatio > 0
          ? { aspectRatio: `${photo.aspectRatio}` }
          : { aspectRatio: "1/1" }
      }
    >
      {/* Blurred thumbnail placeholder — always rendered, fades out */}
      <div className="absolute inset-0 z-0">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className={`w-full h-full object-cover blur-lg scale-110 transition-opacity duration-700 ${isReady ? "opacity-0" : "opacity-100"}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary/50">
            {loadingOptimized && (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/20" />
            )}
          </div>
        )}
      </div>

      {/* Main image — optimized WebP or raw fallback */}
      {(optimizedUrl || rawUrl) && (
        <motion.img
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          src={optimizedUrl || rawUrl || ""}
          loading="lazy"
          alt={decryptedName || getFileName(photo.key)}
          className="relative z-10 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
        />
      )}

      {/* No thumbnail and no optimized and not loading — show placeholder */}
      {!displayUrl && !loadingOptimized && (
        <div className="relative z-10 w-full flex items-center justify-center aspect-square bg-secondary-900/50">
          <ImageOff className="w-8 h-8 text-muted-foreground/20" />
        </div>
      )}

      {/* Loading spinner overlay when no thumb yet */}
      {loadingOptimized && !thumbUrl && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
        </div>
      )}

      {/* Hover overlay — refined Pinterest style */}
      <div className="absolute inset-0 z-20 bg-black/0 group-hover:bg-black/10 transition-all duration-300 flex flex-col justify-end">
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
  privateKey,
}: {
  photos: ObjectData[];
  onPhotoClick: (p: ObjectData) => void;
  decryptedNames: Record<string, string>;
  metadataKey: CryptoKey | null;
  privateKey: CryptoKey | null;
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
                  privateKey={privateKey}
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
  privateKey,
}: {
  photos: ObjectData[];
  density: GridDensity;
  onPhotoClick: (p: ObjectData) => void;
  decryptedNames: Record<string, string>;
  metadataKey: CryptoKey | null;
  privateKey: CryptoKey | null;
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
          privateKey={privateKey}
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
  const { isUnlocked, metadataKey, privateKey } = useCrypto();
  const { data: session } = useSession();
  const userId = session?.user?.id || null;

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

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            {(["masonry", "large", "medium", "small"] as const).map((mode) => {
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
            })}
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
        <div key={dateLabel} className="space-y-4">
          <div className="sticky top-0 z-30 py-2 -mx-4 px-4 bg-background/80 backdrop-blur-md border-b border-border/0 data-stuck:border-border/50 transition-colors">
            <p className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
              {dateLabel}
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-bold ml-auto">
                {groupPhotos.length} item{groupPhotos.length !== 1 ? "s" : ""}
              </span>
            </p>
          </div>
          {gridMode === "masonry" ? (
            <MasonryGrid
              photos={groupPhotos}
              onPhotoClick={(photo) => openPreview(photo, filteredPhotos)}
              decryptedNames={decryptedNames}
              metadataKey={metadataKey}
              privateKey={privateKey}
            />
          ) : (
            <UniformGrid
              photos={groupPhotos}
              density={gridMode as GridDensity}
              onPhotoClick={(photo) => openPreview(photo, filteredPhotos)}
              decryptedNames={decryptedNames}
              metadataKey={metadataKey}
              privateKey={privateKey}
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
  );
}
