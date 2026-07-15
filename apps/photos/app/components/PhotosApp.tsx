"use client";

import { useCallback, useEffect, useState } from "react";
import { AlbumEditor } from "./AlbumEditor";
import { AlbumView } from "./AlbumView";
import { AlbumsList, type AlbumSummary } from "./AlbumsList";
import { Lightbox } from "./Lightbox";
import { PhotosShell } from "./PhotosShell";
import { SelectionController, usePhotoSelection } from "./SelectionController";
import { ShareDialog } from "./ShareDialog";
import { Timeline, type TimelineAsset } from "./Timeline";
import { UploadController } from "./UploadController";

export function PhotosApp() {
  return (
    <SelectionController>
      <PhotosAppInner />
    </SelectionController>
  );
}

function PhotosAppInner() {
  const selection = usePhotoSelection();
  const [spaceId, setSpaceId] = useState("");
  const [view, setView] = useState<"timeline" | "albums">("timeline");
  const [lightbox, setLightbox] = useState<TimelineAsset | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [album, setAlbum] = useState<AlbumSummary | null>(null);

  const loadAlbums = useCallback(async (space: string) => {
    const response = await fetch(
      `/api/photos/albums?spaceId=${encodeURIComponent(space)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const payload = (await response.json()) as { albums: AlbumSummary[] };
    setAlbums(payload.albums);
  }, []);

  useEffect(() => {
    void fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session: { spaceId?: string }) => {
        if (!session.spaceId) return;
        setSpaceId(session.spaceId);
        void loadAlbums(session.spaceId);
      });
  }, [loadAlbums]);

  const selectedIds = [...selection.selected];
  return (
    <PhotosShell
      view={view}
      onView={(next) => {
        setView(next);
        setAlbum(null);
      }}
      actions={
        <>
          <UploadController />
          <ShareDialog selectedIds={selectedIds} />
        </>
      }
    >
      {!spaceId ? <p>Sign in to load your Photos Space.</p> : null}
      {spaceId && view === "timeline" ? (
        <>
          <AlbumEditor
            spaceId={spaceId}
            selectedIds={selectedIds}
            onCreated={() => {
              selection.clear();
              void loadAlbums(spaceId);
            }}
          />
          <Timeline spaceId={spaceId} onOpen={setLightbox} />
        </>
      ) : null}
      {spaceId && view === "albums" && !album ? (
        <AlbumsList albums={albums} onOpen={setAlbum} />
      ) : null}
      {album ? <AlbumView album={album} onBack={() => setAlbum(null)} /> : null}
      <Lightbox asset={lightbox} onClose={() => setLightbox(null)} />
    </PhotosShell>
  );
}
