"use client";

import { useEffect, useState, useCallback } from "react";
import { usePreview } from "@/contexts/PreviewContext";
import { Loader2, ImageOff, LayoutGrid, Grid3x3, Rows3 } from "lucide-react";
import { formatBytes } from "@/lib/utils";

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

function BentoGrid({
  photos,
  onPhotoClick,
}: {
  photos: ObjectData[];
  onPhotoClick: (p: ObjectData) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 auto-rows-[160px] gap-2">
      {photos.map((photo, i) => {
        const isFeatured = i % 7 === 0;
        return (
          <div
            key={photo.id}
            onClick={() => onPhotoClick(photo)}
            className={`relative rounded-xl overflow-hidden bg-secondary border border-border cursor-pointer group transition-all duration-200 hover:scale-[1.02] hover:border-primary/40 hover:z-10 ${
              isFeatured ? "col-span-2 row-span-2" : ""
            }`}
          >
            {photo.thumbnail ? (
              <img
                src={photo.thumbnail}
                alt={getFileName(photo.key)}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-secondary">
                <ImageOff className="w-6 h-6 text-muted-foreground/20" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
              <p className="text-white text-xs font-medium truncate">
                {getFileName(photo.key)}
              </p>
              <p className="text-white/60 text-[10px]">{formatBytes(photo.size)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UniformGrid({
  photos,
  density,
  onPhotoClick,
}: {
  photos: ObjectData[];
  density: GridDensity;
  onPhotoClick: (p: ObjectData) => void;
}) {
  return (
    <div className={`grid ${DENSITY_COLS[density]} gap-2 auto-rows-[140px]`}>
      {photos.map((photo) => (
        <div
          key={photo.id}
          onClick={() => onPhotoClick(photo)}
          className="relative rounded-xl overflow-hidden bg-secondary border border-border cursor-pointer group transition-all duration-200 hover:scale-[1.02] hover:border-primary/40 hover:z-10"
        >
          {photo.thumbnail ? (
            <img
              src={photo.thumbnail}
              alt={getFileName(photo.key)}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary">
              <ImageOff className="w-6 h-6 text-muted-foreground/20" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
            <p className="text-white text-xs font-medium truncate">
              {getFileName(photo.key)}
            </p>
            <p className="text-white/60 text-[10px]">{formatBytes(photo.size)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PhotosGrid() {
  const [photos, setPhotos] = useState<ObjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [gridMode, setGridMode] = useState<"bento" | GridDensity>("bento");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const { openPreview } = usePreview();

  const fetchPhotos = useCallback(
    async (pageNum = 1, append = false) => {
      try {
        if (pageNum === 1) setLoading(true);
        else setLoadingMore(true);

        const configRes = await fetch("/api/drive/config");
        const configData = await configRes.json();

        if (!configData.bucket) {
          setError("Could not access storage.");
          return;
        }

        const bucketId = configData.bucket._id;
        const res = await fetch(
          `/api/objects?bucketId=${bucketId}&contentType=image&limit=50&page=${pageNum}`
        );
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Failed to load photos");
          return;
        }

        const mapped = (data.objects || []).map((o: Record<string, unknown>) => ({
          ...o,
          id: (o._id as string) || (o.id as string),
        }));

        if (append) {
          setPhotos((prev) => [...prev, ...mapped]);
        } else {
          setPhotos(mapped);
        }

        setHasMore(
          (data.pagination as { hasNextPage?: boolean })?.hasNextPage || false
        );
      } catch {
        setError("Failed to load photos.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchPhotos(1);
  }, [fetchPhotos]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPhotos(next, true);
  };

  const filteredPhotos = search.trim()
    ? photos.filter((p) =>
        getFileName(p.key).toLowerCase().includes(search.toLowerCase())
      )
    : photos;

  const grouped = groupByDate(filteredPhotos);
  const groupEntries = Object.entries(grouped);

  if (loading) {
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
          <div className="relative">
            <input
              type="text"
              placeholder="Search Photos"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors w-48"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40"
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
          <div className="flex items-center bg-secondary/50 rounded-lg p-1 border border-border">
            {(["bento", "large", "medium", "small"] as const).map((mode) => {
              const icons: Record<string, React.ReactNode> = {
                bento: <LayoutGrid className="w-3.5 h-3.5" />,
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
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-border flex items-center justify-center mb-4">
            <ImageOff className="w-7 h-7 text-muted-foreground/20" />
          </div>
          <p className="text-sm text-muted-foreground">
            {search ? "No photos match your search" : "No photos yet"}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              Upload images in{" "}
              <a
                href="/dashboard/files"
                className="text-primary hover:underline"
              >
                My Files
              </a>{" "}
              to see them here.
            </p>
          )}
        </div>
      )}

      {/* Photo Groups */}
      {groupEntries.map(([dateLabel, groupPhotos]) => (
        <div key={dateLabel}>
          <p className="text-sm font-medium text-muted-foreground mb-2">
            {dateLabel} &middot; {groupPhotos.length} image
            {groupPhotos.length !== 1 ? "s" : ""}
          </p>
          {gridMode === "bento" ? (
            <BentoGrid photos={groupPhotos} onPhotoClick={openPreview} />
          ) : (
            <UniformGrid
              photos={groupPhotos}
              density={gridMode}
              onPhotoClick={openPreview}
            />
          )}
        </div>
      ))}

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-6 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
