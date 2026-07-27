"use client";

import { Album, ArrowRight, FolderPlus, Images } from "lucide-react";
import { Button } from "@xenode/ui";

export type AlbumSummary = {
  albumId: string;
  encryptedName: string;
  photoAssetIds: string[];
  coverPhotoAssetId?: string;
};

export function AlbumsList({
  albums,
  query,
  onOpen,
}: {
  albums: AlbumSummary[];
  query: string;
  onOpen(album: AlbumSummary): void;
}) {
  const filtered = query.trim()
    ? albums.filter((album) =>
        album.albumId.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : albums;

  if (!albums.length) return <EmptyAlbums />;
  if (!filtered.length) {
    return (
      <div className="grid min-h-[45vh] place-items-center text-center">
        <div>
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-muted">
            <Album className="size-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">No matching albums</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try another search.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {filtered.map((album, index) => (
        <button
          key={album.albumId}
          type="button"
          onClick={() => onOpen(album)}
          className="group overflow-hidden rounded-2xl border border-border/60 bg-card text-left transition duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-xl"
        >
          <div
            className="relative aspect-[4/3] overflow-hidden"
            style={{
              background: `linear-gradient(145deg, hsl(${210 + (index * 29) % 90} 58% 34%), hsl(${245 + (index * 17) % 70} 50% 15%))`,
            }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,.25),transparent_35%)]" />
            <div className="absolute inset-0 grid place-items-center text-white/60 transition duration-500 group-hover:scale-110 group-hover:text-white/80">
              <Images className="size-12" strokeWidth={1.3} />
            </div>
            <span className="absolute bottom-3 right-3 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
              {album.photoAssetIds.length}{" "}
              {album.photoAssetIds.length === 1 ? "photo" : "photos"}
            </span>
          </div>
          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Encrypted album</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Private collection {index + 1}
              </p>
            </div>
            <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
          </div>
        </button>
      ))}
    </section>
  );
}

function EmptyAlbums() {
  return (
    <div className="relative grid min-h-[58vh] place-items-center overflow-hidden rounded-3xl border border-dashed border-border bg-gradient-to-b from-primary/[0.035] to-transparent px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-[2rem] border border-primary/10 bg-primary/[0.06] text-primary">
          <FolderPlus className="size-10" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Group your favorite moments
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          Select photos from your timeline, then create an encrypted album.
          Photos stay in your library.
        </p>
        <Button variant="outline" className="mt-6 rounded-full" disabled>
          <Album className="size-4" />
          Select photos to create an album
        </Button>
      </div>
    </div>
  );
}
