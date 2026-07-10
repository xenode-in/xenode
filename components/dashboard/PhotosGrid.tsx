"use client";

import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { usePreview } from "@/contexts/PreviewContext";
import {
  Album,
  ArrowLeft,
  Check,
  CheckSquare,
  FolderPlus,
  Grid3x3,
  ImageOff,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes, cn } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptMetadataString,
  decryptThumbnail,
  encryptMetadataString,
  encryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { ENCRYPTED_ALBUM_NAME_PLACEHOLDER } from "@/lib/albums/constants";
import { fromB64, toB64 } from "@/lib/crypto/utils";
import {
  bytesToBase64Url,
  decryptOwnerShareKey,
  importShareKey,
} from "@/lib/crypto/shareKey";
import { useThumbnail } from "@/hooks/useThumbnail";
import { GridObject, useGridObjects } from "@/hooks/useLazyGallery";
import { Scrubber } from "@/components/dashboard/Scrubber";
import { AlbumShareDialog } from "@/components/dashboard/AlbumShareDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GridMode = "default" | "grid";

type AlbumRecord = {
  _id: string;
  slug: string;
  name: string;
  encryptedName?: string | null;
  sourceRef?: string | null;
  description?: string;
  objectIds: string[];
  objectCount: number;
  coverObject?: (GridObject & { _id: string }) | null;
  createdAt: string;
  updatedAt: string;
};

type DragSelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

function getColumnCount(mode: GridMode, width: number): number {
  if (mode === "default") {
    if (width >= 1280) return 5;
    if (width >= 1024) return 4;
    if (width >= 768) return 3;
    return 2;
  }
  if (mode === "grid") {
    if (width >= 1280) return 6;
    if (width >= 768) return 5;
    if (width >= 640) return 4;
    return 3;
  }
  return 4;
}

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

function groupByDate(photos: GridObject[]) {
  const groups: Record<string, GridObject[]> = {};
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

// ─────────────────────────────────────────────────────────────────────────────
function normalizeDragBox(box: DragSelectionBox) {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const right = Math.max(box.startX, box.currentX);
  const bottom = Math.max(box.startY, box.currentY);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: DOMRect,
) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

// Thumbnail tile
// ─────────────────────────────────────────────────────────────────────────────

const PhotoThumbnail = memo(function PhotoThumbnail({
  photo,
  onPhotoClick,
  decryptedName,
  metadataKey,
  albums,
  activeAlbumId,
  albumDisplayName,
  onAddToAlbum,
  onCreateAlbumForPhoto,
  onRemoveFromAlbum,
  gridMode,
  selectionMode,
  isSelected,
  onSelectPhoto,
  onTileMount,
}: {
  photo: GridObject;
  onPhotoClick: (p: GridObject) => void;
  decryptedName?: string;
  metadataKey: CryptoKey | null;
  albums: AlbumRecord[];
  activeAlbumId?: string | null;
  albumDisplayName: (album: AlbumRecord) => string;
  onAddToAlbum: (albumId: string, photoId: string) => void;
  onCreateAlbumForPhoto: (photo: GridObject) => void;
  onRemoveFromAlbum?: (albumId: string, photoId: string) => void;
  gridMode: GridMode;
  selectionMode: boolean;
  isSelected: boolean;
  onSelectPhoto: (
    photo: GridObject,
    options?: { toggle?: boolean; range?: boolean; additive?: boolean },
  ) => void;
  onTileMount: (photoId: string, element: HTMLDivElement | null) => void;
}) {
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  const setTileNode = useCallback(
    (node: HTMLDivElement | null) => {
      tileRef.current = node;
      onTileMount(photo._id, node);
    },
    [onTileMount, photo._id],
  );

  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (hideTimer !== null) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          setVisible(true);
        } else {
          hideTimer = setTimeout(() => setVisible(false), 150);
        }
      },
      { rootMargin: "400px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (hideTimer !== null) clearTimeout(hideTimer);
    };
  }, []);

  const thumbUrl = useThumbnail(
    visible && photo.thumbnail ? photo.thumbnail : undefined,
    metadataKey,
  );

  const activeAlbum = activeAlbumId
    ? albums.find(
        (album) => album.slug === activeAlbumId || album._id === activeAlbumId,
      )
    : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setTileNode}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) {
              event.preventDefault();
              onSelectPhoto(photo, {
                toggle: !event.shiftKey,
                range: event.shiftKey,
                additive: event.metaKey || event.ctrlKey,
              });
              return;
            }
            onPhotoClick(photo);
          }}
          className={cn(
            "relative w-full rounded-2xl overflow-hidden bg-secondary border cursor-pointer group transition-all",
            isSelected
              ? "border-primary/80 ring-1 ring-primary/70"
              : "border-border/50",
          )}
          style={
            gridMode === "grid"
              ? { aspectRatio: "1/1" }
              : photo.aspectRatio && photo.aspectRatio > 0
              ? { aspectRatio: `${photo.aspectRatio}` }
              : { aspectRatio: "1/1" }
          }
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={decryptedName || getFileName(photo.key)}
              decoding="async"
              draggable={false}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
            />
          ) : (
            <div className="relative w-full h-full overflow-hidden rounded-2xl bg-zinc-900">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          )}

          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectPhoto(photo, { toggle: true });
            }}
            className={cn(
              "absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-all",
              selectionMode || isSelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/60 bg-black/25 text-white backdrop-blur-md hover:bg-black/45",
            )}
            aria-label={isSelected ? "Deselect photo" : "Select photo"}
          >
            {isSelected ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <span className="h-3 w-3 rounded-full border-2 border-current" />
            )}
          </button>

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300 flex flex-col justify-end">
            <div className="p-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 bg-gradient-to-t from-black/60 via-black/20 to-transparent">
              <p className="text-white text-sm font-medium truncate drop-shadow-md">
                {decryptedName || photo.encryptedName || getFileName(photo.key)}
              </p>
              {photo.size > 0 && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-white/60 text-[10px] uppercase tracking-wider font-bold">
                    {formatBytes(photo.size)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>Add to album</ContextMenuLabel>
        {albums.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Album className="mr-2 h-4 w-4" />
              Choose album
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              {albums.map((album) => {
                const alreadyInAlbum = album.objectIds.includes(photo._id);
                return (
                  <ContextMenuItem
                    key={album._id}
                    disabled={alreadyInAlbum}
                    onSelect={() => onAddToAlbum(album._id, photo._id)}
                  >
                    {alreadyInAlbum && <Check className="mr-2 h-4 w-4" />}
                    <span className={alreadyInAlbum ? "" : "ml-6"}>
                      {albumDisplayName(album)}
                    </span>
                  </ContextMenuItem>
                );
              })}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem disabled>No albums yet</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => onCreateAlbumForPhoto(photo)}>
          <FolderPlus className="mr-2 h-4 w-4" />
          New album with photo
        </ContextMenuItem>
        {activeAlbum && onRemoveFromAlbum && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => onRemoveFromAlbum(activeAlbum._id, photo._id)}
              className="text-destructive focus:text-destructive"
            >
              <X className="mr-2 h-4 w-4" />
              Remove from {albumDisplayName(activeAlbum)}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

const AlbumCover = memo(function AlbumCover({
  album,
  displayName,
  metadataKey,
}: {
  album: AlbumRecord;
  displayName: string;
  metadataKey: CryptoKey | null;
}) {
  const thumbUrl = useThumbnail(
    album.coverObject?.thumbnail ?? undefined,
    metadataKey,
  );

  return (
    <div className="aspect-square overflow-hidden rounded-lg bg-secondary border border-border/50">
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt={displayName}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center">
          <Album className="h-10 w-10 text-muted-foreground/35" />
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
function TooltipIconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Grid layout variants
// ─────────────────────────────────────────────────────────────────────────────

// Grids inline virtualized

// ─────────────────────────────────────────────────────────────────────────────
type PhotosGridProps = {
  initialViewMode?: "photos" | "albums";
  initialAlbumId?: string | null;
};

// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function PhotosGrid({
  initialViewMode = "photos",
  initialAlbumId = null,
}: PhotosGridProps = {}) {
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [search, setSearch] = useState("");
  const [gridMode, setGridMode] = useState<GridMode>("default");
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const [decryptedAlbumNames, setDecryptedAlbumNames] = useState<
    Record<string, string>
  >({});
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"photos" | "albums">(
    initialViewMode,
  );
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(
    initialAlbumId,
  );
  const [albumDialogOpen, setAlbumDialogOpen] = useState(false);
  const [albumDialogMode, setAlbumDialogMode] = useState<"create" | "rename">(
    "create",
  );
  const [albumName, setAlbumName] = useState("");
  const [pendingAlbumPhotos, setPendingAlbumPhotos] = useState<GridObject[]>([]);
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [bulkAlbumDialogOpen, setBulkAlbumDialogOpen] = useState(false);
  const [bulkTargetAlbumId, setBulkTargetAlbumId] = useState("");
  const [bulkAlbumSaving, setBulkAlbumSaving] = useState(false);
  const [dragBox, setDragBox] = useState<DragSelectionBox | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const router = useRouter();
  const { openPreview } = usePreview();
  const { isUnlocked, metadataKey, privateKey, setModalOpen } = useCrypto();
  const tileElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const selectedPhotoIdsRef = useRef<string[]>([]);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    additive: boolean;
    baseSelectedIds: Set<string>;
  } | null>(null);
  const dragSelectedIdsRef = useRef<Set<string>>(new Set());
  const lastDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const albumNameMigrationRanRef = useRef(false);

  useEffect(() => {
    selectedPhotoIdsRef.current = selectedPhotoIds;
  }, [selectedPhotoIds]);

  useEffect(() => {
    setViewMode(initialViewMode);
    setActiveAlbumId(initialAlbumId);
    setSearch("");
    setSelectedPhotoIds([]);
    setSelectionMode(false);
  }, [initialAlbumId, initialViewMode]);

  const loadAlbums = useCallback(async () => {
    try {
      setAlbumsLoading(true);
      const res = await fetch("/api/albums", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load albums");
      const data = await res.json();
      setAlbums(data.albums ?? []);
    } catch {
      toast.error("Failed to load albums");
      setAlbums([]);
    } finally {
      setAlbumsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlbums();
  }, [loadAlbums]);

  // ── Bucket config (one-time fetch) ──────────────────────────────────────────

  useEffect(() => {
    fetch("/api/drive/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.bucket) setBucketId(data.bucket._id);
        else setConfigError("Failed to initialize drive storage");
      })
      .catch(() => setConfigError("Failed to connect to storage"))
      .finally(() => setInitialLoading(false));
  }, []);

  // ── All grid data — one request, no pagination ──────────────────────────────

  const {
    data: gridData,
    isLoading: gridLoading,
    isError: gridError,
  } = useGridObjects(bucketId, { mediaCategory: "image" });

  const gridItems = gridData?.items;
  const allPhotos: GridObject[] = useMemo(() => gridItems ?? [], [gridItems]);
  // `activeAlbumId` carries the URL identifier, which is a slug (older links
  // may still pass a raw _id), so match on either.
  const activeAlbum = useMemo(
    () =>
      albums.find(
        (album) => album.slug === activeAlbumId || album._id === activeAlbumId,
      ) ?? null,
    [albums, activeAlbumId],
  );
  const showingAlbumList = viewMode === "albums" && !activeAlbumId;
  const albumPhotoIds = useMemo(
    () => new Set(activeAlbum?.objectIds ?? []),
    [activeAlbum],
  );
  const sourcePhotos = useMemo(
    () =>
      activeAlbum
        ? allPhotos.filter((photo) => albumPhotoIds.has(photo._id))
        : activeAlbumId
          ? []
        : allPhotos,
    [activeAlbum, activeAlbumId, albumPhotoIds, allPhotos],
  );

  // ── Name decryption ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isUnlocked || !allPhotos.length) {
      setDecryptedNames((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const run = async () => {
      const newNames: Record<string, string> = {};
      for (const photo of allPhotos) {
        const raw = photo.encryptedDisplayName || photo.encryptedName;
        if (photo.isEncrypted && raw && !decryptedNames[photo._id]) {
          try {
            newNames[photo._id] = await decryptMetadataString(raw, metadataKey);
          } catch {
            // leave encrypted name as-is
          }
        }
      }
      if (Object.keys(newNames).length > 0) {
        setDecryptedNames((prev) => ({ ...prev, ...newNames }));
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPhotos, isUnlocked, metadataKey]);

  // ── Album name decryption (E2EE album names) ────────────────────────────────

  useEffect(() => {
    if (!isUnlocked || !metadataKey || !albums.length) {
      setDecryptedAlbumNames((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const run = async () => {
      const newNames: Record<string, string> = {};
      for (const album of albums) {
        if (album.encryptedName && !decryptedAlbumNames[album._id]) {
          try {
            newNames[album._id] = await decryptMetadataString(
              album.encryptedName,
              metadataKey,
            );
          } catch {
            // leave placeholder name as-is
          }
        }
      }
      if (Object.keys(newNames).length > 0) {
        setDecryptedAlbumNames((prev) => ({ ...prev, ...newNames }));
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albums, isUnlocked, metadataKey]);

  const albumDisplayName = useCallback(
    (album: AlbumRecord) =>
      decryptedAlbumNames[album._id] ??
      (album.name !== ENCRYPTED_ALBUM_NAME_PLACEHOLDER
        ? album.name
        : "Encrypted album"),
    [decryptedAlbumNames],
  );

  // ── One-time migration: encrypt legacy plaintext album names ────────────────

  useEffect(() => {
    if (!isUnlocked || !metadataKey || albumsLoading || !albums.length) return;
    if (albumNameMigrationRanRef.current) return;

    const pending = albums.filter(
      (album) =>
        !album.encryptedName &&
        album.name &&
        album.name !== ENCRYPTED_ALBUM_NAME_PLACEHOLDER,
    );
    if (pending.length === 0) return;
    albumNameMigrationRanRef.current = true;

    const run = async () => {
      // Sequential on purpose — gentle on the API, and failures are simply
      // retried on the next page load.
      for (const album of pending) {
        try {
          const encryptedName = await encryptMetadataString(
            album.name,
            metadataKey,
          );
          const res = await fetch(`/api/albums/${album._id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ encryptedName }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setDecryptedAlbumNames((prev) => ({
            ...prev,
            [album._id]: album.name,
          }));
          setAlbums((prev) =>
            prev.map((item) =>
              item._id === album._id
                ? {
                    ...item,
                    encryptedName,
                    name: ENCRYPTED_ALBUM_NAME_PLACEHOLDER,
                  }
                : item,
            ),
          );
        } catch (error) {
          console.warn(
            `Album name migration failed for album ${album._id}`,
            error,
          );
        }
      }
    };

    void run();
  }, [albums, albumsLoading, isUnlocked, metadataKey]);

  // ── Search filter ────────────────────────────────────────────────────────────

  const filteredPhotos = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sourcePhotos;
    return sourcePhotos.filter((p) => {
      const name =
        decryptedNames[p._id] || p.encryptedName || getFileName(p.key);
      return name.toLowerCase().includes(query);
    });
  }, [sourcePhotos, search, decryptedNames]);
  const visiblePhotoIds = useMemo(
    () => new Set(filteredPhotos.map((photo) => photo._id)),
    [filteredPhotos],
  );
  const selectedPhotoIdSet = useMemo(
    () => new Set(selectedPhotoIds),
    [selectedPhotoIds],
  );
  const selectedPhotos = useMemo(
    () => allPhotos.filter((photo) => selectedPhotoIdSet.has(photo._id)),
    [allPhotos, selectedPhotoIdSet],
  );

  useEffect(() => {
    setSelectedPhotoIds((prev) => {
      const next = prev.filter((photoId) => visiblePhotoIds.has(photoId));
      selectedPhotoIdsRef.current = next;
      if (
        selectionAnchorIdRef.current &&
        !visiblePhotoIds.has(selectionAnchorIdRef.current)
      ) {
        selectionAnchorIdRef.current = next[0] ?? null;
      }
      return next;
    });
  }, [visiblePhotoIds]);

  const grouped = useMemo(() => groupByDate(filteredPhotos), [filteredPhotos]);
  const groupEntries = useMemo(() => Object.entries(grouped), [grouped]);
  const scrubberItems = filteredPhotos;

  // ── Scrubber state ────────────────────────────────────────────────────────────

  // ── Scrubber & Virtualization State ─────────────────────────────────────────

  const [scrollProgress, setScrollProgress] = useState(0);
  const galleryContainerRef = useRef<HTMLDivElement | null>(null);
  const [windowWidth, setWindowWidth] = useState<number>(0);

  useEffect(() => {
    setWindowWidth(window.innerWidth);
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const columnCount = useMemo(() => {
    if (windowWidth === 0) return 4;
    return getColumnCount(gridMode, windowWidth);
  }, [gridMode, windowWidth]);

  const { virtualItemsData, labelToVirtualIndex, photoIndexToVirtualIndex } = useMemo(() => {
    const data: Array<
      | { type: "header"; dateLabel: string; count: number; photoIndex: number; photos: GridObject[] }
      | { type: "grid"; photos: GridObject[]; dateLabel: string; photoIndex: number }
    > = [];
    const labelToIndex: Record<string, number> = {};
    const photoToVirtual: number[] = [];

    let runningPhotoIndex = 0;
    groupEntries.forEach(([dateLabel, groupPhotos]) => {
      // 1. Add header
      const headerIndex = data.length;
      data.push({
        type: "header",
        dateLabel,
        count: groupPhotos.length,
        photoIndex: runningPhotoIndex,
        photos: groupPhotos,
      });
      labelToIndex[dateLabel] = headerIndex;

      // 2. Add grid
      const gridIndex = data.length;
      data.push({
        type: "grid",
        photos: groupPhotos,
        dateLabel,
        photoIndex: runningPhotoIndex,
      });

      groupPhotos.forEach(() => {
        photoToVirtual.push(headerIndex);
      });

      runningPhotoIndex += groupPhotos.length;
    });

    return {
      virtualItemsData: data,
      labelToVirtualIndex: labelToIndex,
      photoIndexToVirtualIndex: photoToVirtual,
    };
  }, [groupEntries]);

  const photoContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const updateMargin = () => {
      if (photoContainerRef.current) {
        const rect = photoContainerRef.current.getBoundingClientRect();
        setScrollMargin(rect.top + window.scrollY);
      }
    };
    updateMargin();
    const timer = setTimeout(updateMargin, 150);
    window.addEventListener("resize", updateMargin);
    window.addEventListener("scroll", updateMargin);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateMargin);
      window.removeEventListener("scroll", updateMargin);
    };
  }, [filteredPhotos.length, gridLoading, gridError]);

  const virtualizer = useWindowVirtualizer({
    count: virtualItemsData.length,
    estimateSize: (index) => {
      const item = virtualItemsData[index];
      if (!item) return 200;
      if (item.type === "header") return 50;
      const rowsCount = Math.ceil(item.photos.length / columnCount);
      return rowsCount * 220;
    },
    scrollMargin,
    overscan: 3,
  });

  const firstVisibleIndex = useMemo(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return 0;
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    // Finding the first item that is visible below the 68px top-bar
    const activeItem = items.find((item) => item.end > scrollOffset + 68);
    return activeItem?.index ?? items[0].index;
  }, [virtualizer, virtualizer.scrollOffset]);

  useEffect(() => {
    const item = virtualItemsData[firstVisibleIndex];
    if (!item) return;
    const progress = item.photoIndex / Math.max(1, filteredPhotos.length - 1);
    setScrollProgress(progress);
  }, [firstVisibleIndex, virtualItemsData, filteredPhotos.length]);

  const currentDateLabel = useMemo(() => {
    const item = virtualItemsData[firstVisibleIndex];
    return item?.dateLabel ?? "";
  }, [firstVisibleIndex, virtualItemsData]);

  const handleScrub = useCallback(
    (index: number) => {
      const vIdx = photoIndexToVirtualIndex[index];
      if (vIdx !== undefined) {
        setScrollProgress(index / Math.max(1, scrubberItems.length - 1));
        virtualizer.scrollToIndex(vIdx, { align: "start" });
      }
    },
    [photoIndexToVirtualIndex, virtualizer, scrubberItems.length],
  );

  // ── Photo click ──────────────────────────────────────────────────────────────

  const filteredPhotosRef = useRef<GridObject[]>([]);
  filteredPhotosRef.current = filteredPhotos;

  const handlePhotoClick = useCallback(
    (photo: GridObject) => {
      // PreviewContext / FilePreviewDialog reads `.id` (not `._id`).
      // GridObject comes from /api/objects/grid which returns `_id`.
      // Bridge the gap by spreading `id` alongside the existing fields.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const asLegacy = (p: GridObject) => ({ ...p, id: p._id }) as any;
      openPreview(asLegacy(photo), filteredPhotosRef.current.map(asLegacy));
    },
    [openPreview],
  );

  const clearSelection = useCallback(() => {
    setSelectedPhotoIds([]);
    selectedPhotoIdsRef.current = [];
    selectionAnchorIdRef.current = null;
    setSelectionMode(false);
  }, []);

  const selectPhoto = useCallback(
    (
      photo: GridObject,
      options: { toggle?: boolean; range?: boolean; additive?: boolean } = {},
    ) => {
      setSelectionMode(true);

      setSelectedPhotoIds((prev) => {
        const current = new Set(prev);

        if (options.range && selectionAnchorIdRef.current) {
          const anchorIndex = filteredPhotos.findIndex(
            (item) => item._id === selectionAnchorIdRef.current,
          );
          const targetIndex = filteredPhotos.findIndex(
            (item) => item._id === photo._id,
          );

          if (anchorIndex !== -1 && targetIndex !== -1) {
            const start = Math.min(anchorIndex, targetIndex);
            const end = Math.max(anchorIndex, targetIndex);
            const rangeIds = filteredPhotos
              .slice(start, end + 1)
              .map((item) => item._id);
            return options.additive
              ? Array.from(new Set([...prev, ...rangeIds]))
              : rangeIds;
          }
        }

        if (options.toggle) {
          if (current.has(photo._id)) current.delete(photo._id);
          else current.add(photo._id);
          selectionAnchorIdRef.current = photo._id;
          return Array.from(current);
        }

        selectionAnchorIdRef.current = photo._id;
        return [photo._id];
      });

      if (!options.range) {
        selectionAnchorIdRef.current = photo._id;
      }
    },
    [filteredPhotos],
  );

  const selectAllVisible = useCallback(() => {
    setSelectionMode(true);
    const nextIds = filteredPhotos.map((photo) => photo._id);
    selectedPhotoIdsRef.current = nextIds;
    selectionAnchorIdRef.current = nextIds[0] ?? null;
    setSelectedPhotoIds(nextIds);
  }, [filteredPhotos]);

  const togglePhotoGroupSelection = useCallback((photos: GridObject[]) => {
    if (photos.length === 0) return;

    setSelectedPhotoIds((prev) => {
      const groupIds = photos.map((photo) => photo._id);
      const groupIdSet = new Set(groupIds);
      const allSelected = groupIds.every((id) => prev.includes(id));
      const next = allSelected
        ? prev.filter((id) => !groupIdSet.has(id))
        : Array.from(new Set([...prev, ...groupIds]));

      selectedPhotoIdsRef.current = next;
      selectionAnchorIdRef.current = allSelected
        ? next[0] ?? null
        : groupIds[0] ?? null;
      setSelectionMode(next.length > 0);
      return next;
    });
  }, []);

  const registerPhotoTile = useCallback(
    (photoId: string, element: HTMLDivElement | null) => {
      if (element) {
        tileElementsRef.current.set(photoId, element);
      } else {
        tileElementsRef.current.delete(photoId);
      }
    },
    [],
  );

  const updateDragSelection = useCallback((currentX: number, currentY: number) => {
    const start = dragStartRef.current;
    if (!start) return;

    lastDragPointRef.current = { x: currentX, y: currentY };

    const nextBox = {
      startX: start.x,
      startY: start.y,
      currentX,
      currentY,
    };
    const normalizedBox = normalizeDragBox(nextBox);
    const nextSelectedIds = new Set(
      start.additive ? start.baseSelectedIds : [],
    );

    tileElementsRef.current.forEach((element, photoId) => {
      if (rectsIntersect(normalizedBox, element.getBoundingClientRect())) {
        dragSelectedIdsRef.current.add(photoId);
      }
    });

    dragSelectedIdsRef.current.forEach((photoId) => {
      nextSelectedIds.add(photoId);
    });

    const nextSelected = Array.from(nextSelectedIds);
    selectedPhotoIdsRef.current = nextSelected;
    setSelectedPhotoIds(nextSelected);
    setDragBox(nextBox);
  }, []);

  const stopDragAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const startDragAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) return;

    const tick = () => {
      const point = lastDragPointRef.current;
      if (!dragStartRef.current || !dragMovedRef.current || !point) {
        autoScrollFrameRef.current = null;
        return;
      }

      const edgeSize = 96;
      const maxSpeed = 24;
      let scrollY = 0;

      if (point.y < edgeSize) {
        scrollY = -Math.ceil(((edgeSize - point.y) / edgeSize) * maxSpeed);
      } else if (point.y > window.innerHeight - edgeSize) {
        scrollY = Math.ceil(
          ((point.y - (window.innerHeight - edgeSize)) / edgeSize) * maxSpeed,
        );
      }

      if (scrollY !== 0) {
        window.scrollBy({ top: scrollY, behavior: "auto" });
        updateDragSelection(point.x, point.y);
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
  }, [updateDragSelection]);

  const handlePhotoGridPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        event.pointerType === "touch" ||
        showingAlbumList ||
        gridLoading ||
        gridError ||
        filteredPhotos.length === 0
      ) {
        return;
      }

      const target = event.target as HTMLElement;
      if (
        target.closest(
          "button,a,input,textarea,select,[role='menuitem'],[data-selection-ignore='true']",
        )
      ) {
        return;
      }

      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        additive: event.metaKey || event.ctrlKey || event.shiftKey,
        baseSelectedIds: new Set(selectedPhotoIdsRef.current),
      };
      dragSelectedIdsRef.current = new Set();
      lastDragPointRef.current = { x: event.clientX, y: event.clientY };
      dragMovedRef.current = false;
      // NOTE: do NOT setPointerCapture here. Capturing on pointerdown
      // redirects the subsequent `click` event to this container instead of
      // the photo tile, which would swallow the tile click that opens the
      // preview. Capture is acquired only once a real drag begins (below).
    },
    [filteredPhotos.length, gridError, gridLoading, showingAlbumList],
  );

  const handlePhotoGridPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;

      const movedX = event.clientX - start.x;
      const movedY = event.clientY - start.y;
      const distance = Math.hypot(movedX, movedY);

      if (!dragMovedRef.current) {
        if (distance < 8) return;
        dragMovedRef.current = true;
        suppressNextClickRef.current = true;
        selectionAnchorIdRef.current = null;
        setSelectionMode(true);
        startDragAutoScroll();
        // Acquire pointer capture now that a drag is actually underway, so
        // pointermove/up keep targeting the grid even if the cursor leaves it.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture can fail if the browser already cancelled the gesture.
        }
      }

      event.preventDefault();
      updateDragSelection(event.clientX, event.clientY);
    },
    [startDragAutoScroll, updateDragSelection],
  );

  const finishPhotoGridDrag = useCallback(
    (event?: React.PointerEvent<HTMLDivElement>) => {
      const wasDragging = dragMovedRef.current;

      if (event && dragStartRef.current) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // It is safe if capture was already released by the browser.
        }
      }

      dragStartRef.current = null;
      dragSelectedIdsRef.current = new Set();
      lastDragPointRef.current = null;
      dragMovedRef.current = false;
      stopDragAutoScroll();
      setDragBox(null);

      if (wasDragging) {
        selectionAnchorIdRef.current = selectedPhotoIdsRef.current.at(-1) ?? null;
        suppressNextClickRef.current = true;
        if (selectedPhotoIdsRef.current.length === 0) {
          setSelectionMode(false);
        }
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
      }
    },
    [stopDragAutoScroll],
  );

  const handlePhotoGridClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!suppressNextClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressNextClickRef.current = false;
    },
    [],
  );

  useEffect(() => {
    return () => {
      stopDragAutoScroll();
    };
  }, [stopDragAutoScroll]);

  const openCreateAlbumDialog = useCallback((photoOrPhotos?: GridObject | GridObject[]) => {
    setAlbumDialogMode("create");
    setPendingAlbumPhotos(
      Array.isArray(photoOrPhotos)
        ? photoOrPhotos
        : photoOrPhotos
          ? [photoOrPhotos]
          : [],
    );
    setEditingAlbumId(null);
    setAlbumName("");
    setAlbumDialogOpen(true);
  }, []);

  const openRenameAlbumDialog = useCallback(
    (album: AlbumRecord) => {
      setAlbumDialogMode("rename");
      setPendingAlbumPhotos([]);
      setEditingAlbumId(album._id);
      setAlbumName(albumDisplayName(album));
      setAlbumDialogOpen(true);
    },
    [albumDisplayName],
  );

  const syncAlbumShare = useCallback(
    async (
      albumId: string,
      options: { addedPhotoIds?: string[]; albumName?: string },
    ) => {
      const shareRes = await fetch(`/api/albums/${albumId}/share`, {
        credentials: "include",
      });
      const shareData = await shareRes.json().catch(() => ({}));
      if (!shareRes.ok || !shareData.share) return;

      const ownerEncryptedShareKey = shareData.share.ownerEncryptedShareKey;
      if (!ownerEncryptedShareKey) return;

      if (!privateKey) {
        setModalOpen(true);
        toast.warning("Unlock your vault to update the live album link.");
        return;
      }

      const shareKeyRaw = await decryptOwnerShareKey(
        ownerEncryptedShareKey,
        privateKey,
      );
      const shareKeyObj = await importShareKey(shareKeyRaw, [
        "wrapKey",
        "encrypt",
      ]);
      const payload: Record<string, unknown> = {};

      if (options.albumName) {
        payload.shareEncryptedAlbumName = await encryptWithShareKey(
          options.albumName,
          shareKeyObj,
        );
      }

      const existingIds = new Set<string>(shareData.share.itemObjectIds ?? []);
      const addedPhotoIds = options.addedPhotoIds ?? [];
      const missingIds = addedPhotoIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        let bucketId = "";
        try {
          const cfg = await (await fetch("/api/drive/config")).json();
          bucketId = cfg?.bucket?._id ?? "";
        } catch {
          /* thumbnails simply won't upload */
        }

        const shareNonce = bytesToBase64Url(
          crypto.getRandomValues(new Uint8Array(8)),
        );
        const photoById = new Map(allPhotos.map((photo) => [photo._id, photo]));
        const items = await Promise.all(
          missingIds.map(async (objectId) => {
            const metaRes = await fetch(`/api/objects/${objectId}`, {
              credentials: "include",
            });
            const meta = await metaRes.json();
            if (!metaRes.ok) throw new Error(meta.error || "Failed to read photo");

            const item: Record<string, string> = { objectId };

            if (meta.isEncrypted) {
              if (!meta.encryptedDEK) throw new Error("Photo missing encryption key");
              const rawDEK = await crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                privateKey,
                fromB64(meta.encryptedDEK),
              );
              const dekKey = await crypto.subtle.importKey(
                "raw",
                rawDEK,
                { name: "AES-GCM" },
                true,
                ["encrypt", "decrypt"],
              );
              const iv = crypto.getRandomValues(new Uint8Array(12));
              const wrapped = await crypto.subtle.wrapKey(
                "raw",
                dekKey,
                shareKeyObj,
                { name: "AES-GCM", iv },
              );
              item.shareEncryptedDEK = toB64(wrapped);
              item.shareKeyIv = toB64(iv);

              if (metadataKey) {
                if (meta.encryptedName) {
                  const plainName = await decryptMetadataString(
                    meta.encryptedName,
                    metadataKey,
                  );
                  item.shareEncryptedName = await encryptWithShareKey(
                    plainName,
                    shareKeyObj,
                  );
                }
                if (meta.encryptedContentType) {
                  const plainType = await decryptMetadataString(
                    meta.encryptedContentType,
                    metadataKey,
                  );
                  item.shareEncryptedContentType = await encryptWithShareKey(
                    plainType,
                    shareKeyObj,
                  );
                }
              }
            }

            const photo = photoById.get(objectId);
            try {
              if (photo?.thumbnail && metadataKey && bucketId) {
                const urlRes = await fetch("/api/objects/thumbnail/batch", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ keys: [photo.thumbnail] }),
                });
                const { urls } = await urlRes.json();
                const signed = urls?.[photo.thumbnail];
                if (signed) {
                  const content = await (await fetch(signed)).text();
                  const dataUrl = content.startsWith("enc:")
                    ? await decryptThumbnail(content, metadataKey)
                    : content;
                  const reEncrypted = await encryptWithShareKey(
                    dataUrl,
                    shareKeyObj,
                  );
                  const presignRes = await fetch("/api/objects/presign-upload", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      bucketId,
                      prefix: "shares/",
                      fileName: `album-${objectId}-${shareNonce}-thumb`,
                      fileType: "application/octet-stream",
                      fileSize: reEncrypted.length,
                    }),
                  });
                  const { uploadUrl, objectKey } = await presignRes.json();
                  if (uploadUrl && objectKey) {
                    await fetch(uploadUrl, {
                      method: "PUT",
                      body: reEncrypted,
                      headers: { "Content-Type": "application/octet-stream" },
                    });
                    item.shareEncryptedThumbnail = objectKey;
                  }
                }
              }
            } catch (thumbErr) {
              console.warn("Failed to prepare shared thumbnail", thumbErr);
            }

            return item;
          }),
        );
        payload.items = items;
      }

      if (!payload.items && !payload.shareEncryptedAlbumName) return;

      const patchRes = await fetch(`/api/albums/${albumId}/share`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update live album share");
      }
    },
    [allPhotos, metadataKey, privateKey, setModalOpen],
  );

  const handleSaveAlbum = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = albumName.trim();
      if (!trimmed) return;

      setSavingAlbum(true);
      const canEncryptName = isUnlocked && !!metadataKey;
      try {
        if (albumDialogMode === "create") {
          const createBody: Record<string, unknown> = {
            objectIds: pendingAlbumPhotos.map((photo) => photo._id),
          };
          if (canEncryptName && metadataKey) {
            createBody.encryptedName = await encryptMetadataString(
              trimmed,
              metadataKey,
            );
          } else {
            createBody.name = trimmed;
          }
          const res = await fetch("/api/albums", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(createBody),
          });
          if (!res.ok) throw new Error("Failed to create album");
          const data = await res.json();
          setAlbums((prev) => [data.album, ...prev]);
          if (canEncryptName) {
            setDecryptedAlbumNames((prev) => ({
              ...prev,
              [data.album._id]: trimmed,
            }));
          }
          toast.success("Album created");
          if (pendingAlbumPhotos.length > 0) {
            setActiveAlbumId(data.album.slug);
            setViewMode("photos");
            router.push(`/dashboard/albums/${data.album.slug}`);
            clearSelection();
          } else {
            setViewMode("albums");
            router.push("/dashboard/albums");
          }
        } else if (editingAlbumId) {
          const renameBody: Record<string, unknown> =
            canEncryptName && metadataKey
              ? {
                  encryptedName: await encryptMetadataString(
                    trimmed,
                    metadataKey,
                  ),
                }
              : { name: trimmed };
          const res = await fetch(`/api/albums/${editingAlbumId}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(renameBody),
          });
          if (!res.ok) throw new Error("Failed to rename album");
          const data = await res.json();
          setAlbums((prev) =>
            prev.map((album) =>
              album._id === editingAlbumId
                ? {
                    ...album,
                    name: data.album.name,
                    encryptedName: data.album.encryptedName ?? album.encryptedName,
                    updatedAt: data.album.updatedAt,
                  }
                : album,
            ),
          );
          if (canEncryptName) {
            setDecryptedAlbumNames((prev) => ({
              ...prev,
              [editingAlbumId]: trimmed,
            }));
          }
          // The live share encrypts the name under its own share key, so it
          // always receives the plaintext regardless of E2EE album names.
          await syncAlbumShare(editingAlbumId, { albumName: trimmed }).catch(
            (syncError) => {
              toast.warning(
                syncError instanceof Error
                  ? syncError.message
                  : "Album renamed, but the live share name was not updated.",
              );
            },
          );
          toast.success("Album renamed");
        }
        setAlbumDialogOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Album action failed",
        );
      } finally {
        setSavingAlbum(false);
      }
    },
    [
      albumDialogMode,
      albumName,
      clearSelection,
      editingAlbumId,
      isUnlocked,
      metadataKey,
      pendingAlbumPhotos,
      router,
      syncAlbumShare,
    ],
  );

  const handleAddToAlbum = useCallback(
    async (albumId: string, photoId: string) => {
      const album = albums.find((item) => item._id === albumId);
      if (album?.objectIds.includes(photoId)) return;

      setAlbums((prev) =>
        prev.map((item) =>
          item._id === albumId
            ? {
                ...item,
                objectIds: [...item.objectIds, photoId],
                objectCount: item.objectCount + 1,
              }
            : item,
        ),
      );

      try {
        const res = await fetch(`/api/albums/${albumId}/objects`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objectIds: [photoId] }),
        });
        if (!res.ok) throw new Error("Failed to add photo");
        const data = await res.json();
        setAlbums((prev) =>
          prev.map((item) =>
            item._id === albumId
              ? {
                  ...item,
                  objectIds: data.album.objectIds,
                  objectCount: data.album.objectCount,
                  coverObjectId: data.album.coverObjectId,
                }
              : item,
          ),
        );
        await syncAlbumShare(albumId, {
          addedPhotoIds: [photoId],
          albumName: decryptedAlbumNames[albumId] ?? data.album.name,
        }).catch((syncError) => {
          toast.warning(
            syncError instanceof Error
              ? syncError.message
              : "Added to album, but the live share was not updated.",
          );
        });
        toast.success("Added to album");
        void loadAlbums();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add photo");
        void loadAlbums();
      }
    },
    [albums, decryptedAlbumNames, loadAlbums, syncAlbumShare],
  );

  const handleAddSelectionToAlbum = useCallback(async () => {
    if (!bulkTargetAlbumId || selectedPhotoIds.length === 0) return;
    const photoIds = selectedPhotoIds;
    setBulkAlbumSaving(true);

    try {
      const res = await fetch(`/api/albums/${bulkTargetAlbumId}/objects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectIds: photoIds }),
      });
      if (!res.ok) throw new Error("Failed to add selected photos");
      const data = await res.json();
      setAlbums((prev) =>
        prev.map((item) =>
          item._id === bulkTargetAlbumId
            ? {
                ...item,
                objectIds: data.album.objectIds,
                objectCount: data.album.objectCount,
                coverObjectId: data.album.coverObjectId,
              }
            : item,
          ),
      );
      await syncAlbumShare(bulkTargetAlbumId, {
        addedPhotoIds: photoIds,
        albumName: decryptedAlbumNames[bulkTargetAlbumId] ?? data.album.name,
      }).catch((syncError) => {
        toast.warning(
          syncError instanceof Error
            ? syncError.message
            : "Added to album, but the live share was not updated.",
        );
      });
      toast.success(
        `${photoIds.length} photo${photoIds.length !== 1 ? "s" : ""} added`,
      );
      setBulkAlbumDialogOpen(false);
      setBulkTargetAlbumId("");
      clearSelection();
      void loadAlbums();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add selected photos",
      );
      void loadAlbums();
    } finally {
      setBulkAlbumSaving(false);
    }
  }, [
    bulkTargetAlbumId,
    clearSelection,
    decryptedAlbumNames,
    loadAlbums,
    selectedPhotoIds,
    syncAlbumShare,
  ]);

  const handleRemoveFromAlbum = useCallback(
    async (albumId: string, photoId: string) => {
      setAlbums((prev) =>
        prev.map((item) =>
          item._id === albumId
            ? {
                ...item,
                objectIds: item.objectIds.filter((id) => id !== photoId),
                objectCount: Math.max(0, item.objectCount - 1),
              }
            : item,
        ),
      );

      try {
        const res = await fetch(`/api/albums/${albumId}/objects`, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objectIds: [photoId] }),
        });
        if (!res.ok) throw new Error("Failed to remove photo");
        const data = await res.json();
        setAlbums((prev) =>
          prev.map((item) =>
            item._id === albumId
              ? {
                  ...item,
                  objectIds: data.album.objectIds,
                  objectCount: data.album.objectCount,
                  coverObjectId: data.album.coverObjectId,
                }
              : item,
          ),
        );
        toast.success("Removed from album");
        void loadAlbums();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to remove photo",
        );
        void loadAlbums();
      }
    },
    [loadAlbums],
  );

  const handleRemoveSelectionFromAlbum = useCallback(async () => {
    if (!activeAlbumId || selectedPhotoIds.length === 0) return;
    const photoIds = selectedPhotoIds;

    setAlbums((prev) =>
      prev.map((item) =>
        item._id === activeAlbum?._id
          ? {
              ...item,
              objectIds: item.objectIds.filter((id) => !photoIds.includes(id)),
              objectCount: Math.max(0, item.objectCount - photoIds.length),
            }
          : item,
      ),
    );

    try {
      const res = await fetch(`/api/albums/${activeAlbumId}/objects`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectIds: photoIds }),
      });
      if (!res.ok) throw new Error("Failed to remove selected photos");
      const data = await res.json();
      setAlbums((prev) =>
        prev.map((item) =>
          item._id === activeAlbum?._id
            ? {
                ...item,
                objectIds: data.album.objectIds,
                objectCount: data.album.objectCount,
                coverObjectId: data.album.coverObjectId,
              }
            : item,
        ),
      );
      toast.success(
        `${photoIds.length} photo${photoIds.length !== 1 ? "s" : ""} removed`,
      );
      clearSelection();
      void loadAlbums();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to remove selected photos",
      );
      void loadAlbums();
    }
  }, [activeAlbum, activeAlbumId, clearSelection, loadAlbums, selectedPhotoIds]);

  const handleDeleteAlbum = useCallback(
    async (albumId: string) => {
      const album = albums.find((item) => item._id === albumId);
      if (!album) return;
      if (
        !window.confirm(
          `Delete "${albumDisplayName(album)}"? Photos stay in your vault.`,
        )
      ) {
        return;
      }

      try {
        const res = await fetch(`/api/albums/${albumId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to delete album");
        setAlbums((prev) => prev.filter((item) => item._id !== albumId));
        if (activeAlbum?._id === albumId) {
          setActiveAlbumId(null);
          setViewMode("albums");
          router.push("/dashboard/albums");
        }
        toast.success("Album deleted");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete album",
        );
      }
    },
    [activeAlbum, albumDisplayName, albums, router],
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const headerTitle = activeAlbum
    ? albumDisplayName(activeAlbum)
    : activeAlbumId
      ? "Album"
    : showingAlbumList
      ? "Albums"
      : "Photos";
  const headerCount = activeAlbum
    ? `${filteredPhotos.length} image${filteredPhotos.length !== 1 ? "s" : ""}`
    : activeAlbumId
      ? albumsLoading
        ? "Loading album..."
        : "Album not found"
    : showingAlbumList
      ? `${albums.length} album${albums.length !== 1 ? "s" : ""}`
      : `${filteredPhotos.length} image${filteredPhotos.length !== 1 ? "s" : ""}`;
  const emptyTitle = activeAlbumId && !activeAlbum && !albumsLoading
    ? "Album not found"
    : activeAlbum
      ? search
        ? "No matches found"
        : "This album is empty"
      : search
        ? "No matches found"
        : "Your gallery is empty";
  const emptyDescription = activeAlbumId && !activeAlbum && !albumsLoading
    ? "This album may have been deleted or is no longer available."
    : activeAlbum
      ? search
        ? "We couldn't find any photos matching your search in this album."
        : "Add photos from the Photos page or right-click any photo to place it here."
      : search
        ? "We couldn't find any photos matching your search."
        : "Start building your visual library by uploading images to your vault.";
  const currentDatePhotos = currentDateLabel
    ? grouped[currentDateLabel] ?? []
    : [];
  const currentDateSelectedCount = currentDatePhotos.filter((photo) =>
    selectedPhotoIdSet.has(photo._id),
  ).length;
  const currentDateAllSelected =
    currentDatePhotos.length > 0 &&
    currentDateSelectedCount === currentDatePhotos.length;
  const currentDateSomeSelected =
    currentDateSelectedCount > 0 && !currentDateAllSelected;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex gap-2 items-start">
      {/* Gallery content */}
      <div className="grow min-w-0">
        <div ref={galleryContainerRef} className="space-y-6 pb-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {activeAlbumId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setActiveAlbumId(null);
                      setViewMode("albums");
                      setSearch("");
                      router.push("/dashboard/albums");
                    }}
                    aria-label="Back to albums"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <h1 className="truncate text-2xl font-semibold text-foreground">
                  {headerTitle}
                </h1>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {headerCount}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-secondary/30 backdrop-blur-md rounded-xl p-1 border border-border/50">
                <Link
                  href="/dashboard/photos"
                  className={cn(
                    "inline-flex h-8 items-center px-3 rounded-md text-sm transition-colors",
                    !showingAlbumList && !activeAlbum
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Photos
                </Link>
                <Link
                  href="/dashboard/albums"
                  className={cn(
                    "inline-flex h-8 items-center px-3 rounded-md text-sm transition-colors",
                    showingAlbumList || activeAlbumId
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Albums
                </Link>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openCreateAlbumDialog()}
              >
                <Plus className="h-4 w-4" />
                Album
              </Button>

              {!showingAlbumList && (
                <TooltipIconButton
                  label={selectionMode ? "Clear selection" : "Select photos"}
                  type="button"
                  variant={selectionMode ? "secondary" : "outline"}
                  size="icon-sm"
                  onClick={() => {
                    if (selectionMode) clearSelection();
                    else setSelectionMode(true);
                  }}
                >
                  {selectionMode ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </TooltipIconButton>
              )}

              {activeAlbum && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShareDialogOpen(true)}
                    disabled={activeAlbum.objectCount === 0}
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openRenameAlbumDialog(activeAlbum)}
                    aria-label="Rename album"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDeleteAlbum(activeAlbum._id)}
                    aria-label="Delete album"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}

              {/* Search */}
              {!showingAlbumList && (
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
              )}

              {/* Grid density toggle */}
              {!showingAlbumList && (
              <div className="flex items-center bg-secondary/30 backdrop-blur-md rounded-xl p-1 border border-border/50">
                {([
                  { mode: "default", label: "Default", icon: LayoutGrid },
                  { mode: "grid", label: "Grid", icon: Grid3x3 },
                ] as const).map(({ mode, label, icon: Icon }) => (
                  <TooltipIconButton
                    key={mode}
                    label={label}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setGridMode(mode)}
                    className={cn(
                      "h-7 w-7 rounded-md",
                      gridMode === mode
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </TooltipIconButton>
                ))}
              </div>
              )}
            </div>
          </div>

          {selectionMode && !showingAlbumList && (
            <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur-md">
              <span className="min-w-20 px-3 text-center text-sm font-medium text-foreground">
                {selectedPhotoIds.length} selected
              </span>
              <div className="h-5 w-px bg-border" />
              <TooltipIconButton
                label="Select all"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={selectAllVisible}
                disabled={filteredPhotos.length === 0}
              >
                <CheckSquare className="h-4 w-4" />
              </TooltipIconButton>
              <TooltipIconButton
                label="Add to album"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setBulkAlbumDialogOpen(true)}
                disabled={selectedPhotoIds.length === 0 || albums.length === 0}
              >
                <Album className="h-4 w-4" />
              </TooltipIconButton>
              <TooltipIconButton
                label="New album"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => openCreateAlbumDialog(selectedPhotos)}
                disabled={selectedPhotoIds.length === 0}
              >
                <FolderPlus className="h-4 w-4" />
              </TooltipIconButton>
              {activeAlbum && (
                <TooltipIconButton
                  label="Remove from album"
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRemoveSelectionFromAlbum}
                  disabled={selectedPhotoIds.length === 0}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </TooltipIconButton>
              )}
              <TooltipIconButton
                label="Clear selection"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={clearSelection}
              >
                <X className="h-4 w-4" />
              </TooltipIconButton>
            </div>
          )}

          {/* Config error */}
          {configError && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              {configError}
            </div>
          )}

          {/* Grid loading */}
          {(gridLoading || (activeAlbumId && albumsLoading)) && (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}

          {/* Grid error */}
          {gridError && !gridLoading && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              Failed to load photos
            </div>
          )}

          {showingAlbumList && (
            <div className="px-4">
              {albumsLoading ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : albums.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {albums.map((album) => (
                    <div key={album._id} className="group">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAlbumId(album.slug);
                          setViewMode("photos");
                          setSearch("");
                          router.push(`/dashboard/albums/${album.slug}`);
                        }}
                        className="block w-full text-left"
                      >
                        <AlbumCover
                          album={album}
                          displayName={albumDisplayName(album)}
                          metadataKey={metadataKey}
                        />
                        <div className="mt-2 min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {albumDisplayName(album)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {album.objectCount} image
                            {album.objectCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </button>
                      <div className="mt-2 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => openRenameAlbumDialog(album)}
                          aria-label="Rename album"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDeleteAlbum(album._id)}
                          aria-label="Delete album"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-32 text-center">
                  <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-secondary/40">
                    <Album className="h-9 w-9 text-muted-foreground/40" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    No albums yet
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-6">
                    Create an album from here, or right-click any photo and add it to a new album.
                  </p>
                  <Button type="button" onClick={() => openCreateAlbumDialog()}>
                    <FolderPlus className="h-4 w-4" />
                    New Album
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Empty */}
          {!showingAlbumList && !gridLoading && !(activeAlbumId && albumsLoading) && !gridError && filteredPhotos.length === 0 && (
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
                {emptyTitle}
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-8">
                {emptyDescription}
              </p>
              {!search && !activeAlbumId && (
                <a
                  href="/dashboard/files"
                  className="inline-flex items-center justify-center px-6 h-11 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0"
                >
                  Upload First Photo
                </a>
              )}
            </div>
          )}

          {/* Floating Glassmorphism Sticky Date Header */}
          {!showingAlbumList && currentDateLabel && (
            <div className="sticky top-[68px] z-30 py-2 -mx-4 px-4 bg-background/80 backdrop-blur-md border-b border-border/10 transition-colors">
              <p className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePhotoGroupSelection(currentDatePhotos)}
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                    currentDateAllSelected || currentDateSomeSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/60",
                  )}
                  aria-label={
                    currentDateAllSelected
                      ? `Deselect ${currentDateLabel}`
                      : `Select ${currentDateLabel}`
                  }
                >
                  {currentDateAllSelected ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : currentDateSomeSelected ? (
                    <span className="h-0.5 w-2.5 rounded-full bg-current" />
                  ) : null}
                </button>
                {currentDateLabel}
              </p>
            </div>
          )}

          {/* Virtualized photo container */}
          {!showingAlbumList && !gridLoading && !gridError && filteredPhotos.length > 0 && (
            <div
              ref={photoContainerRef}
              onPointerDown={handlePhotoGridPointerDown}
              onPointerMove={handlePhotoGridPointerMove}
              onPointerUp={finishPhotoGridDrag}
              onPointerCancel={finishPhotoGridDrag}
              onLostPointerCapture={() => finishPhotoGridDrag()}
              onClickCapture={handlePhotoGridClickCapture}
              className={cn(dragBox && "select-none")}
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = virtualItemsData[virtualRow.index];
                if (!item) return null;

                if (item.type === "header") {
                  const selectedInGroup = item.photos.filter((photo) =>
                    selectedPhotoIdSet.has(photo._id),
                  ).length;
                  const allInGroupSelected =
                    item.photos.length > 0 && selectedInGroup === item.photos.length;
                  const someInGroupSelected =
                    selectedInGroup > 0 && !allInGroupSelected;

                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                      }}
                      className="py-2 px-4 border-b border-border/5"
                    >
                      <div className="text-sm font-semibold text-foreground/60 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => togglePhotoGroupSelection(item.photos)}
                          className={cn(
                            "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                            allInGroupSelected || someInGroupSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:border-primary/60",
                          )}
                          aria-label={
                            allInGroupSelected
                              ? `Deselect ${item.dateLabel}`
                              : `Select ${item.dateLabel}`
                          }
                        >
                          {allInGroupSelected ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : someInGroupSelected ? (
                            <span className="h-0.5 w-2.5 rounded-full bg-current" />
                          ) : null}
                        </button>
                        {item.dateLabel}
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-bold ml-auto">
                          {item.count} item{item.count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  );
                }

                // Default columns preserve photo aspect ratios.
                if (gridMode === "default") {
                  const columns: GridObject[][] = Array.from({ length: columnCount }, () => []);
                  item.photos.forEach((photo, i) => {
                    columns[i % columnCount].push(photo);
                  });

                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                      }}
                      className="flex gap-4 px-4 py-2"
                    >
                      {columns.map((column, i) => (
                        <div key={i} className="flex-1 flex flex-col gap-4">
                          {column.map((photo) => (
                            <PhotoThumbnail
                              key={photo._id}
                              photo={photo}
                              onPhotoClick={handlePhotoClick}
                              decryptedName={decryptedNames[photo._id]}
                              metadataKey={metadataKey}
                              albums={albums}
                              activeAlbumId={activeAlbumId}
                              albumDisplayName={albumDisplayName}
                              onAddToAlbum={handleAddToAlbum}
                              onCreateAlbumForPhoto={openCreateAlbumDialog}
                              onRemoveFromAlbum={handleRemoveFromAlbum}
                              gridMode={gridMode}
                              selectionMode={selectionMode}
                              isSelected={selectedPhotoIdSet.has(photo._id)}
                              onSelectPhoto={selectPhoto}
                              onTileMount={registerPhotoTile}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                }

                // Uniform Grid rows layout
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                    }}
                    className={cn(
                      "grid grid-cols-3 gap-3 px-4 py-2 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 xl:grid-cols-6",
                    )}
                  >
                    {item.photos.map((photo) => (
                      <PhotoThumbnail
                        key={photo._id}
                        photo={photo}
                        onPhotoClick={handlePhotoClick}
                        decryptedName={decryptedNames[photo._id]}
                        metadataKey={metadataKey}
                        albums={albums}
                        activeAlbumId={activeAlbumId}
                        onAddToAlbum={handleAddToAlbum}
                        onCreateAlbumForPhoto={openCreateAlbumDialog}
                        onRemoveFromAlbum={handleRemoveFromAlbum}
                        gridMode={gridMode}
                        selectionMode={selectionMode}
                        isSelected={selectedPhotoIdSet.has(photo._id)}
                        onSelectPhoto={selectPhoto}
                        onTileMount={registerPhotoTile}
                      />
                    ))}
                  </div>
                );
              })}
              {dragBox && (() => {
                const box = normalizeDragBox(dragBox);
                return (
                  <div
                    className="pointer-events-none fixed z-[60] rounded-sm border border-primary/60 bg-primary/10 shadow-sm"
                    style={{
                      left: box.left,
                      top: box.top,
                      width: box.width,
                      height: box.height,
                    }}
                  />
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Timeline scrubber */}
      {!showingAlbumList && scrubberItems.length > 0 && (
        <div className="sticky top-[68px] h-[calc(100dvh-68px)] shrink-0">
          <Scrubber
            items={scrubberItems}
            scrollProgress={scrollProgress}
            onScrub={handleScrub}
          />
        </div>
      )}

      <Dialog open={albumDialogOpen} onOpenChange={setAlbumDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSaveAlbum} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {albumDialogMode === "create" ? "New Album" : "Rename Album"}
              </DialogTitle>
              <DialogDescription>
                {pendingAlbumPhotos.length > 0
                  ? `${pendingAlbumPhotos.length} selected photo${
                      pendingAlbumPhotos.length !== 1 ? "s" : ""
                    } will be added when the album is created.`
                  : "Albums organize photos without moving files in your vault."}
              </DialogDescription>
            </DialogHeader>
            <Input
              value={albumName}
              onChange={(event) => setAlbumName(event.target.value)}
              placeholder="Album name"
              autoFocus
              maxLength={80}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAlbumDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingAlbum || !albumName.trim()}>
                {savingAlbum && <Loader2 className="h-4 w-4 animate-spin" />}
                {albumDialogMode === "create" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkAlbumDialogOpen} onOpenChange={setBulkAlbumDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Album</DialogTitle>
            <DialogDescription>
              Add {selectedPhotoIds.length} selected photo
              {selectedPhotoIds.length !== 1 ? "s" : ""} to an existing album.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {albums.map((album) => (
              <button
                key={album._id}
                type="button"
                onClick={() => setBulkTargetAlbumId(album._id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  bulkTargetAlbumId === album._id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                <span className="truncate font-medium">
                  {albumDisplayName(album)}
                </span>
                <span className="ml-3 text-xs text-muted-foreground">
                  {album.objectCount}
                </span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkAlbumDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddSelectionToAlbum}
              disabled={!bulkTargetAlbumId || bulkAlbumSaving}
            >
              {bulkAlbumSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeAlbum && (
        <AlbumShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          albumId={activeAlbum.slug}
          albumName={albumDisplayName(activeAlbum)}
          photos={allPhotos
            .filter((p) => activeAlbum.objectIds.includes(p._id))
            .map((p) => ({ objectId: p._id, thumbnail: p.thumbnail }))}
        />
      )}
    </div>
    </TooltipProvider>
  );
}
