"use client";

import { useCallback, useEffect, useState } from "react";
import { AlbumEditor } from "./AlbumEditor";
import { AlbumView } from "./AlbumView";
import { AlbumsList, type AlbumSummary } from "./AlbumsList";
import { Lightbox } from "./Lightbox";
import { PhotosShell } from "./PhotosShell";
import { SelectionController, usePhotoSelection } from "./SelectionController";
import { Timeline, type TimelineAsset } from "./Timeline";
import { UploadController } from "./UploadController";
import { getClientPhotosSession } from "@/lib/client-session";
import { openAlbumName } from "@/lib/album-name";
import { usePhotosMetadataKey } from "./PhotosKeyAccess";

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
  const [accountId, setAccountId] = useState("");
  const metadataKey = usePhotosMetadataKey(spaceId);
  const [albumNames, setAlbumNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<"timeline" | "albums">("timeline");
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<TimelineAsset | null>(null);
  const [previewAssets, setPreviewAssets] = useState<TimelineAsset[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [album, setAlbum] = useState<AlbumSummary | null>(null);
  const [timelineVersion, setTimelineVersion] = useState(0);

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
    void getClientPhotosSession()
      .then((session) => {
        if (!session.spaceId) return;
        setSpaceId(session.spaceId);
        setAccountId(session.accountId);
        void loadAlbums(session.spaceId);
      })
      .catch(() => {
        // PhotosKeyAccess owns the sign-in status and recovery action.
      });
  }, [loadAlbums]);

  // Album titles exist only as envelopes; decrypt them for display and search.
  useEffect(() => {
    if (!metadataKey || !albums.length) return;
    let active = true;
    void Promise.all(
      albums.map(async (entry) =>
        [entry.albumId, await openAlbumName(entry.encryptedName, metadataKey, spaceId)] as const,
      ),
    ).then((pairs) => {
      if (!active) return;
      setAlbumNames(
        Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair[1] !== null)),
      );
    });
    return () => {
      active = false;
    };
  }, [albums, metadataKey, spaceId]);

  const selectedIds = [...selection.selected];
  return (
    <PhotosShell
      view={view}
      search={search}
      onSearch={setSearch}
      onView={(next) => {
        setView(next);
        setAlbum(null);
        setSearch("");
        selection.clear();
      }}
      actions={
        <>
          {view === "timeline" ? (
            <UploadController
              spaceId={spaceId}
              onUploaded={() => setTimelineVersion((version) => version + 1)}
            />
          ) : null}
          {view === "timeline" && selectedIds.length ? (
            <AlbumEditor
              spaceId={spaceId}
              accountId={accountId}
              selectedIds={selectedIds}
              onCreated={() => {
                selection.clear();
                void loadAlbums(spaceId);
              }}
            />
          ) : null}
        </>
      }
    >
      {!spaceId ? <LibraryLoading /> : null}
      {spaceId && view === "timeline" ? (
        <Timeline
          key={`${spaceId}:${timelineVersion}`}
          spaceId={spaceId}
          query={search}
          onOpen={(asset, assets) => {
            setPreviewAssets(assets);
            setLightbox(asset);
          }}
        />
      ) : null}
      {spaceId && view === "albums" && !album ? (
        <AlbumsList
          albums={albums}
          names={albumNames}
          query={search}
          onOpen={setAlbum}
        />
      ) : null}
      {album ? (
        <AlbumView album={album} name={albumNames[album.albumId]} onBack={() => setAlbum(null)} />
      ) : null}
      <Lightbox
        asset={lightbox}
        assets={previewAssets}
        onChange={setLightbox}
        onClose={() => setLightbox(null)}
      />
    </PhotosShell>
  );
}

function LibraryLoading() {
  return (
    <div className="grid min-h-[52vh] place-items-center">
      <div className="text-center">
        <div className="mx-auto mb-4 size-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="text-sm font-medium">Opening your private library</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Checking your Photos Space and encryption key…
        </p>
      </div>
    </div>
  );
}
