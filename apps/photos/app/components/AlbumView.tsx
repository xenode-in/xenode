"use client";

import { ArrowLeft, Image as ImageIcon, LockKeyhole } from "lucide-react";
import { Button } from "@xenode/ui";
import type { AlbumSummary } from "./AlbumsList";

export function AlbumView({
  album,
  onBack,
}: {
  album: AlbumSummary;
  onBack(): void;
}) {
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
              Encrypted album
            </h2>
            <LockKeyhole className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {album.photoAssetIds.length}{" "}
            {album.photoAssetIds.length === 1 ? "photo" : "photos"}
          </p>
        </div>
      </div>

      {album.photoAssetIds.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {album.photoAssetIds.map((id, index) => (
            <div
              key={id}
              className="group relative aspect-square overflow-hidden rounded-xl border border-border/50"
              style={{
                background: `linear-gradient(145deg, hsl(${205 + (index * 37) % 130} 55% 32%), hsl(${240 + (index * 19) % 100} 50% 14%))`,
              }}
            >
              <div className="absolute inset-0 grid place-items-center text-white/55">
                <ImageIcon className="size-8 transition group-hover:scale-110" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-h-[45vh] place-items-center rounded-3xl border border-dashed border-border text-center">
          <div>
            <ImageIcon className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">This album is empty</p>
          </div>
        </div>
      )}
    </section>
  );
}
