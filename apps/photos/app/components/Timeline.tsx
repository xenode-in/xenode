"use client";

import { useMemo, useState } from "react";
import {
  Grid3X3,
  ImageOff,
  Images,
  LayoutGrid,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button, cn } from "@xenode/ui";
import { PhotoGrid } from "./PhotoGrid";
import { usePhotoPages } from "./usePhotoPages";

export type TimelineAsset = {
  id: string;
  spaceId: string;
  mediaType: "image" | "video";
  takenAt: string;
  width?: number;
  height?: number;
  storageObjectId?: string;
  previewUrl?: string;
  status?: "active" | "trashed";
};

export type TimelineGroup = {
  label: string;
  shortLabel: string;
  assets: TimelineAsset[];
};

export function Timeline({
  spaceId,
  query,
  onOpen,
}: {
  spaceId: string;
  query: string;
  onOpen(asset: TimelineAsset, assets: TimelineAsset[]): void;
}) {
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const { items, cursor, loaded, loading, error, load, loadMore } =
    usePhotoPages(`/api/photos/timeline?spaceId=${encodeURIComponent(spaceId)}`);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((asset) => {
      const date = new Date(asset.takenAt);
      const dateLabel = date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      return (
        asset.mediaType.includes(normalized) ||
        dateLabel.toLocaleLowerCase().includes(normalized)
      );
    });
  }, [items, query]);

  const groups = useMemo<TimelineGroup[]>(() => {
    const result: TimelineGroup[] = [];
    for (const asset of filtered) {
      const date = new Date(asset.takenAt);
      const label = date.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const existing = result.at(-1);
      if (existing?.label === label) {
        existing.assets.push(asset);
      } else {
        result.push({
          label,
          shortLabel: date.toLocaleDateString(undefined, {
            month: "short",
            year: "numeric",
          }),
          assets: [asset],
        });
      }
    }
    return result;
  }, [filtered]);

  if (!loaded && loading) {
    return (
      <div className="grid min-h-[52vh] place-items-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="grid min-h-[52vh] place-items-center text-center">
        <div>
          <p className="font-medium">{error}</p>
          <Button
            variant="outline"
            className="mt-4 rounded-full"
            onClick={() => void load(null)}
          >
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loaded && items.length === 0) {
    return <EmptyTimeline />;
  }

  if (filtered.length === 0) {
    return (
      <div className="grid min-h-[45vh] place-items-center text-center">
        <div>
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-muted">
            <ImageOff className="size-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">No matching photos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {cursor
              ? "No match among the photos loaded so far."
              : "Try a date, month, or media type."}
          </p>
          {cursor ? (
            <Button
              variant="outline"
              className="mt-4 rounded-full"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Search older photos
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between border-b border-border/50 pb-4">
        <p className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
          {query.trim() && cursor
            ? " among loaded photos · older photos load as you scroll"
            : ""}
        </p>
        <div className="flex rounded-xl border border-border/60 bg-muted/50 p-1">
          <button
            type="button"
            onClick={() => setDensity("comfortable")}
            className={cn(
              "grid size-8 place-items-center rounded-lg transition",
              density === "comfortable"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
            aria-label="Comfortable gallery"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setDensity("compact")}
            className={cn(
              "grid size-8 place-items-center rounded-lg transition",
              density === "compact"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
            aria-label="Compact gallery"
          >
            <Grid3X3 className="size-4" />
          </button>
        </div>
      </div>

      <PhotoGrid
        groups={groups}
        density={density}
        onOpen={(asset) => onOpen(asset, filtered)}
        onEndReached={loadMore}
      />
      {loading ? (
        <div className="flex justify-center pb-8 pt-2">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : error && cursor ? (
        <div className="flex justify-center pb-8 pt-2">
          <Button
            variant="outline"
            className="rounded-full px-6"
            onClick={() => void load(cursor)}
          >
            <RefreshCw className="size-4" />
            Load older memories
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="relative grid min-h-[58vh] place-items-center overflow-hidden rounded-3xl border border-dashed border-border bg-gradient-to-b from-primary/[0.035] to-transparent px-6 text-center">
      <div className="pointer-events-none absolute left-[12%] top-[18%] size-20 rotate-[-8deg] rounded-2xl border border-primary/10 bg-card/70 shadow-sm" />
      <div className="pointer-events-none absolute bottom-[16%] right-[13%] size-24 rotate-[7deg] rounded-2xl border border-primary/10 bg-card/70 shadow-sm" />
      <div className="relative max-w-md">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-[2rem] border border-primary/10 bg-primary/[0.06] text-primary shadow-sm">
          <Images className="size-10" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Your memories belong here
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          Add photos and videos to start building a private, end-to-end
          encrypted timeline.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-sm">
          <span className="size-2 rounded-full bg-emerald-500" />
          Protected by your Photos encryption key
        </div>
      </div>
    </div>
  );
}
