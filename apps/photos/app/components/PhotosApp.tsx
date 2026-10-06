"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button, toast } from "@xenode/ui";
import { AlbumEditor } from "./AlbumEditor";
import { AlbumView } from "./AlbumView";
import { AlbumsList, type AlbumSummary } from "./AlbumsList";
import { Lightbox } from "./Lightbox";
import { PhotosShell, type PhotosView } from "./PhotosShell";
import { SelectionController, usePhotoSelection } from "./SelectionController";
import { Timeline, type TimelineAsset } from "./Timeline";
import { TrashView } from "./TrashView";
import { UploadController } from "./UploadController";
import { changePhotoAssets } from "./usePhotoPages";
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
  const [view, setView] = useState<PhotosView>("timeline");
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<TimelineAsset | null>(null);
  const [previewAssets, setPreviewAssets] = useState<TimelineAsset[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [albumsCursor, setAlbumsCursor] = useState<string | null>(null);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [album, setAlbum] = useState<AlbumSummary | null>(null);
  const [timelineVersion, setTimelineVersion] = useState(0);
  const [trashing, setTrashing] = useState(false);

  const loadAlbums = useCallback(
    async (space: string, cursor: string | null = null) => {
      setAlbumsLoading(true);
      try {
        const url = new URL("/api/photos/albums", window.location.origin);
        url.searchParams.set("spaceId", space);
        if (cursor) url.searchParams.set("cursor", cursor);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          albums: AlbumSummary[];
          nextCursor: string | null;
        };
        setAlbums((current) =>
          cursor ? [...current, ...payload.albums] : payload.albums,
        );
        setAlbumsCursor(payload.nextCursor);
      } finally {
        setAlbumsLoading(false);
      }
    },
    [],
  );

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

  async function moveToTrash() {
    setTrashing(true);
    try {
      const { done, error } = await changePhotoAssets("trash", spaceId, selectedIds);
      for (const id of done) selection.toggle(id);
      if (done.length) {
        setTimelineVersion((version) => version + 1);
        toast.success(
          `Moved ${done.length} ${done.length === 1 ? "item" : "items"} to trash`,
        );
      }
      if (error) toast.error(error);
    } finally {
      setTrashing(false);
    }
  }

  const openPreview = (asset: TimelineAsset, assets: TimelineAsset[]) => {
    setPreviewAssets(assets);
    setLightbox(asset);
  };

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
            <>
              <AlbumEditor
                spaceId={spaceId}
                accountId={accountId}
                selectedIds={selectedIds}
                onCreated={() => {
                  selection.clear();
                  void loadAlbums(spaceId);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                disabled={trashing}
                onClick={() => void moveToTrash()}
              >
                {trashing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Move to trash
              </Button>
            </>
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
          onOpen={openPreview}
        />
      ) : null}
      {spaceId && view === "albums" && !album ? (
        <AlbumsList
          albums={albums}
          names={albumNames}
          query={search}
          onOpen={setAlbum}
          hasMore={Boolean(albumsCursor)}
          loadingMore={albumsLoading}
          onLoadMore={() => void loadAlbums(spaceId, albumsCursor)}
        />
      ) : null}
      {album ? (
        <AlbumView
          album={album}
          name={albumNames[album.albumId]}
          spaceId={spaceId}
          onBack={() => setAlbum(null)}
          onOpen={openPreview}
        />
      ) : null}
      {spaceId && view === "trash" ? <TrashView spaceId={spaceId} /> : null}
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
