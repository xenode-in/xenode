"use client";

import { useMemo } from "react";
import {
  ArrowLeft,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { Button } from "@xenode/ui";
import type { AlbumSummary } from "./AlbumsList";
import { PhotoGrid } from "./PhotoGrid";
import type { TimelineAsset } from "./Timeline";
import { usePhotoPages } from "./usePhotoPages";

export function AlbumView({
  album,
  name,
  spaceId,
  onBack,
  onOpen,
}: {
  album: AlbumSummary;
  name?: string;
  spaceId: string;
  onBack(): void;
  onOpen(asset: TimelineAsset, assets: TimelineAsset[]): void;
}) {
  const { items, cursor, loaded, loading, error, load, loadMore } =
    usePhotoPages(
      `/api/photos/albums/${encodeURIComponent(album.albumId)}?spaceId=${encodeURIComponent(spaceId)}`,
    );
  const groups = useMemo(
    () => [{ label: "", shortLabel: "", assets: items }],
    [items],
  );

  return (
    <section>
      <div className="mb-7 flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={onBack}
          aria-label="Back to albums"
        >
          <ArrowLeft />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              {name ?? "Encrypted album"}
            </h2>
            <LockKeyhole className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {album.photoAssetCount}{" "}
            {album.photoAssetCount === 1 ? "item" : "items"}
          </p>
        </div>
      </div>

      {!loaded ? (
        <div className="grid min-h-[45vh] place-items-center">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      ) : error && !items.length ? (
        <div className="grid min-h-[45vh] place-items-center text-center">
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
      ) : !items.length && !cursor ? (
        <div className="grid min-h-[45vh] place-items-center rounded-3xl border border-dashed border-border text-center">
          <div>
            <ImageIcon className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">This album is empty</p>
          </div>
        </div>
      ) : (
        <>
          <PhotoGrid
            groups={groups}
            density="comfortable"
            onOpen={(asset) => onOpen(asset, items)}
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
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
