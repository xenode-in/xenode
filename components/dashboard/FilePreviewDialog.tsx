"use client";

const NOOP = () => {};

import React, { useEffect, useState, useRef, useCallback } from "react";
import { FileVersionsDialog } from "./FileVersionsDialog";
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  AlertCircle,
  X,
  Lock,
  Minimize2,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  History,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { useOptionalDownload } from "@/contexts/DownloadContext";
import { useOptionalCrypto } from "@/contexts/CryptoContext";
import {
  decryptFileWithDEK,
  decryptFileChunkedCombined,
  decryptMetadataString,
  decryptWithShareKey,
  decryptChunk,
  unwrapDEKWithSpaceKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";
import { useVideoStream, VideoStreamOptions } from "@/hooks/useVideoStream";
import {
  createServiceWorkerMediaSession,
  type ServiceWorkerMediaSession,
} from "@/lib/media/serviceWorkerMedia";
import {
  useAudioTrackSyncer,
  SidecarAudioTrack,
} from "@/hooks/useAudioTrackSyncer";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";

import { useRendererConfig } from "@/hooks/useRendererConfig";
import {
  CONSTRAINED_RESOURCE_BUDGET,
  DESKTOP_RESOURCE_BUDGET,
  type BrowserCapabilities,
  decideFileDisposition,
  isDispositionRendererEnabled,
  inspectFileHeader,
  type PreviewDisposition,
  type PreviewIntent,
  type PreviewSourceContext,
  type ResourceBudget,
} from "@/lib/file-security";
import { SafePdfPreview } from "./SafePdfPreview";
import { SafeTextPreview } from "./SafeTextPreview";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "@vidstack/react/player/styles/default/layouts/audio.css";
import { MediaPlayer as VidstackPlayer, MediaProvider } from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
  DefaultAudioLayout,
} from "@vidstack/react/player/layouts/default";
// ─── Zoomable Image ───────────────────────────────────────────────────────────

function ZoomableImage({
  src,
  alt,
  resetKey,
  onZoomIn,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  /** Reset zoom only when this changes (the file id), NOT when `src` swaps
   *  optimized→original — so an HD upgrade keeps the current zoom. */
  resetKey?: string;
  /** Fired when the user zooms in, so the parent can lazy-load the original. */
  onZoomIn?: () => void;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const [, forceRender] = useState(0);
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const onZoomInRef = useRef(onZoomIn);
  onZoomInRef.current = onZoomIn;

  const MIN_SCALE = 1;
  const MAX_SCALE = 8;
  const ZOOM_STEP = 0.15;
  const CLICK_ZOOM_STEP = 0.5;

  const applyZoom = useCallback(
    (clientX: number, clientY: number, direction: number, step = ZOOM_STEP) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = clientX - rect.left - rect.width / 2;
      const mouseY = clientY - rect.top - rect.height / 2;

      const oldScale = scaleRef.current;
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, oldScale * (1 + direction * step)),
      );

      if (newScale === oldScale) return;

      if (newScale <= MIN_SCALE) {
        scaleRef.current = MIN_SCALE;
        translateRef.current = { x: 0, y: 0 };
      } else {
        const ratio = 1 - newScale / oldScale;
        const t = translateRef.current;
        scaleRef.current = newScale;
        translateRef.current = {
          x: t.x + (mouseX - t.x) * ratio,
          y: t.y + (mouseY - t.y) * ratio,
        };
      }

      // Zooming in past 1× → ask the parent to upgrade to the original source.
      if (newScale > MIN_SCALE && newScale > oldScale) {
        onZoomInRef.current?.();
      }

      forceRender((n) => n + 1);
    },
    [],
  );

  // Native wheel listener with { passive: false } so preventDefault actually works
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const direction = e.deltaY < 0 ? 1 : -1;
      applyZoom(e.clientX, e.clientY, direction);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // Block Ctrl+wheel (browser zoom) when hovering over the image container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isHovered = false;

    const onEnter = () => {
      isHovered = true;
    };
    const onLeave = () => {
      isHovered = false;
    };

    const onWindowWheel = (e: WheelEvent) => {
      if (isHovered && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
    };

    container.addEventListener("mouseenter", onEnter);
    container.addEventListener("mouseleave", onLeave);
    window.addEventListener("wheel", onWindowWheel, { passive: false });

    return () => {
      container.removeEventListener("mouseenter", onEnter);
      container.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("wheel", onWindowWheel);
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    didDrag.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    if (scaleRef.current > MIN_SCALE) {
      translateRef.current = {
        x: translateRef.current.x + dx,
        y: translateRef.current.y + dy,
      };
      forceRender((n) => n + 1);
    }
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const wasDragging = isDragging.current;
      const wasDrag = didDrag.current;
      isDragging.current = false;
      didDrag.current = false;

      // Click-to-zoom: only if not dragged
      if (wasDragging && !wasDrag && e.button === 0) {
        applyZoom(e.clientX, e.clientY, 1, CLICK_ZOOM_STEP);
      }
    },
    [applyZoom],
  );

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false;
    didDrag.current = false;
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    scaleRef.current = MIN_SCALE;
    translateRef.current = { x: 0, y: 0 };
    forceRender((n) => n + 1);
  }, []);

  // Reset zoom only when the underlying file changes (resetKey) — NOT when
  // `src` swaps from the optimized to the original image, so an HD upgrade
  // keeps the current zoom/pan. Falls back to `src` if no resetKey is given.
  useEffect(() => {
    scaleRef.current = MIN_SCALE;
    translateRef.current = { x: 0, y: 0 };
    forceRender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey ?? src]);

  const scale = scaleRef.current;
  const translate = translateRef.current;
  const isZoomed = scale > MIN_SCALE;

  return (
    <div
      ref={containerRef}
      className="relative grid h-full place-items-center bg-black/40 overflow-hidden select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
      style={{
        cursor: isZoomed
          ? isDragging.current
            ? "grabbing"
            : "grab"
          : "zoom-in",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="max-h-[calc(100dvh-8.5rem)] w-auto max-w-full object-contain pointer-events-none"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: isDragging.current ? "none" : "transform 0.15s ease-out",
          transformOrigin: "center center",
        }}
        onLoad={onLoad}
        onError={onError}
        draggable={false}
      />
      {isZoomed && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/60 px-3 py-1 text-xs text-white/70 backdrop-blur-sm pointer-events-none">
          {Math.round(scale * 100)}% · double-click to reset
        </div>
      )}
    </div>
  );
}

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  name?: string;
  mediaCategory?: string;
  bucketId?: string;
  thumbnail?: string;
  encryptedContentType?: string;
  url?: string;
  chunkUrls?: string[];
  chunkSize?: number;
  chunkCount?: number;
  chunkIvs?: string;
  encryptedMetadata?: string;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedContentType?: string;
  sidecars?: {
    id: string;
    mediaCategory: string;
    encryptedName?: string;
    size: number;
    contentType: string;
    encryptedContentType?: string;
  }[];
}

function TopPreviewLoader({ progress }: { progress: number | null }) {
  const normalizedProgress =
    typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[70] h-0.5 overflow-hidden bg-white/10">
      {normalizedProgress !== null && normalizedProgress > 0 ? (
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${normalizedProgress}%` }}
        />
      ) : (
        <div className="h-full w-1/3 animate-[preview-loader_1.15s_ease-in-out_infinite] rounded-full bg-primary" />
      )}
      <style jsx>{`
        @keyframes preview-loader {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }
      `}</style>
    </div>
  );
}

function MediaLoadingPlaceholder({
  thumbnailUrl,
  isVideo,
  progress,
}: {
  thumbnailUrl: string | null;
  isVideo: boolean;
  progress: number | null;
}) {
  return (
    <div className="absolute inset-0 z-50 overflow-hidden bg-black">
      {thumbnailUrl ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-80 animate-pulse"
            style={{ backgroundImage: `url(${thumbnailUrl})` }}
          />
          <div className="absolute inset-0 bg-black/45" />
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/[0.07] animate-pulse">
            {isVideo ? (
              <Play className="h-7 w-7 fill-white/70 text-white/70" />
            ) : (
              <div className="relative h-7 w-9 overflow-hidden rounded border border-white/60">
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-white/70" />
                <span className="absolute -bottom-2 left-2 h-5 w-5 rotate-45 bg-white/50" />
              </div>
            )}
          </div>
        </div>
      )}
      {isVideo && thumbnailUrl && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur-sm">
            <Play className="h-7 w-7 fill-white/85 text-white/85" />
          </div>
        </div>
      )}
      <TopPreviewLoader progress={progress} />
    </div>
  );
}
interface FilePreviewDialogProps {
  file: ObjectData | null;
  isOpen: boolean;
  onClose: () => void;
  sourceContext?: PreviewSourceContext;
  intent?: PreviewIntent;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  // Shared link specific props
  sharedToken?: string;
  /** Public album share — streams photos via /api/album-share/[token]. */
  albumShareToken?: string;
  shareKey?: string;
  password?: string;
  directShareId?: string;
  directShareWrappedKey?: string;
  sharedItemId?: string;
  onDownload?: () => void;
}

const ChunkedStreamPlayer = ({
  opts,
  type,
  onUrlChange,
  onReady,
  audioTracks,
  dek,
  privateKey,
  metadataKey,
}: {
  opts: VideoStreamOptions;
  type: string;
  onUrlChange: (url: string | null) => void;
  onReady?: () => void;
  audioTracks?: SidecarAudioTrack[];
  dek?: CryptoKey | null;
  privateKey?: CryptoKey | null;
  metadataKey?: CryptoKey | null;
}) => {
  const isAudio = type.startsWith("audio/");
  const [videoElement, setVideoElement] = useState<HTMLMediaElement | null>(
    null,
  );

  const { blobUrl, error } = useVideoStream(opts, videoElement);
  const hasSidecars = (audioTracks?.filter((t) => t.objectId).length ?? 0) > 1;

  const {
    activeTrackId,
    isLoading: trackLoading,
    selectTrack,
  } = useAudioTrackSyncer({
    videoElement,
    audioTracks: audioTracks ?? [],
    dek: dek ?? null,
    privateKey,
    metadataKey,
  });

  useEffect(() => {
    onUrlChange(blobUrl);
    return () => onUrlChange(null);
  }, [blobUrl, onUrlChange]);

  useEffect(() => {
    if (error && onReady) {
      onReady();
    }
  }, [error, onReady]);

  if (error) {
    if (onReady) onReady();
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex w-full flex-col items-center justify-center bg-black overflow-hidden aspect-video",
        isAudio ? "p-4" : "",
      )}
    >
      <VidstackPlayer
        title="Encrypted Media"
        src={blobUrl || ""}
        onProviderSetup={(provider) => {
          const mediaProvider = provider as {
            video?: HTMLVideoElement;
            audio?: HTMLAudioElement;
          };
          if (provider.type === "video") {
            setVideoElement(mediaProvider.video ?? null);
          } else if (provider.type === "audio") {
            setVideoElement(mediaProvider.audio ?? null);
          }
        }}
        onCanPlay={onReady}
        viewType={isAudio ? "audio" : "video"}
        className="w-full h-full max-h-[85vh] flex items-center justify-center outline-none"
      >
        <MediaProvider />
        {isAudio ? (
          <DefaultAudioLayout icons={defaultLayoutIcons} />
        ) : (
          <DefaultVideoLayout icons={defaultLayoutIcons} />
        )}
      </VidstackPlayer>

      {/* Audio Track Selector — shown only when sidecar audio tracks exist */}
      {hasSidecars && audioTracks && audioTracks.length > 1 && (
        <div className="absolute bottom-16 right-3 z-20 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1.5 backdrop-blur-sm border border-white/10">
          <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider mr-1">
            Audio
          </span>
          {audioTracks.map((track, idx) => (
            <button
              key={track.id}
              onClick={() => selectTrack(idx === 0 ? null : track.id)}
              disabled={trackLoading}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-semibold transition-all duration-150",
                (
                  idx === 0
                    ? activeTrackId === null
                    : activeTrackId === track.id
                )
                  ? "bg-primary text-primary-foreground"
                  : "text-white/70 hover:text-white hover:bg-white/10",
              )}
            >
              {track.language?.toUpperCase() || `Track ${idx + 1}`}
            </button>
          ))}
          {trackLoading && (
            <span className="ml-1 h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
          )}
        </div>
      )}
    </div>
  );
};

const MediaPlayer = ({
  url,
  type,
  onReady,
  audioTracks,
  dek,
  privateKey,
  metadataKey,
}: {
  url: string;
  type: string;
  onReady?: () => void;
  audioTracks?: SidecarAudioTrack[];
  dek?: CryptoKey | null;
  privateKey?: CryptoKey | null;
  metadataKey?: CryptoKey | null;
}) => {
  const isAudio = type.startsWith("audio/");
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(
    null,
  );

  const {
    activeTrackId,
    isLoading: trackLoading,
    selectTrack,
  } = useAudioTrackSyncer({
    videoElement: mediaElement,
    audioTracks: audioTracks ?? [],
    dek: dek ?? null,
    privateKey,
    metadataKey,
  });

  const hasSidecars = (audioTracks?.filter((t) => t.objectId).length ?? 0) > 1;

  return (
    <div
      className={cn(
        "relative w-full h-full flex items-center justify-center bg-black overflow-hidden",
        isAudio ? "p-4" : "",
      )}
    >
      {isAudio ? (
        <audio
          ref={setMediaElement}
          controls
          autoPlay
          className="w-full relative z-20 outline-none"
          src={url}
          onLoadedData={onReady}
        />
      ) : (
        <video
          ref={setMediaElement}
          controls
          autoPlay
          playsInline
          className="w-full h-full max-h-full object-contain z-20 outline-none"
          src={url}
          onLoadedData={onReady}
        />
      )}

      {/* Audio Track Selector for Native Player */}
      {audioTracks && audioTracks.length > 1 && (
        <div className="absolute bottom-16 right-3 z-30 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1.5 backdrop-blur-sm border border-white/10">
          <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider mr-1">
            Audio
          </span>
          {audioTracks.map((track, idx) => (
            <button
              key={track.id}
              onClick={() => selectTrack(idx === 0 ? null : track.id)}
              disabled={trackLoading}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-semibold transition-all duration-150 relative",
                (
                  idx === 0
                    ? activeTrackId === null
                    : activeTrackId === track.id
                )
                  ? "bg-primary text-primary-foreground"
                  : "text-white/70 hover:text-white hover:bg-white/10",
              )}
            >
              {track.language?.toUpperCase() || `Track ${idx + 1}`}
            </button>
          ))}
          {trackLoading && (
            <span className="ml-1 h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
          )}
        </div>
      )}
    </div>
  );
};

const MemoizedMediaPlayer = React.memo(MediaPlayer);

function fileNameFromKey(key: string) {
  const part = key.split("/").pop();
  return part || key;
}

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2);
}
function getPreviewRuntimeProfile(): {
  budget: ResourceBudget;
  capabilities: BrowserCapabilities;
} {
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  const constrained =
    memory === undefined ||
    memory <= 4 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  return {
    budget: constrained ? CONSTRAINED_RESOURCE_BUDGET : DESKTOP_RESOURCE_BUDGET,
    capabilities: {
      messageChannel: typeof MessageChannel !== "undefined",
      mediaSource: typeof MediaSource !== "undefined",
      transferableArrayBuffer: typeof ArrayBuffer !== "undefined",
    },
  };
}

function inferContentTypeFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (
    lower.endsWith(".docx") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".dot") ||
    lower.endsWith(".dotx")
  )
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return null;
}

function inferContentTypeFromCategory(
  category?: string,
  currentType?: string,
): string | null {
  if (category === "image") {
    return currentType?.startsWith("image/") ? currentType : "image/jpeg";
  }
  if (category === "video") {
    return currentType?.startsWith("video/") ? currentType : "video/mp4";
  }
  if (category === "audio") {
    return currentType?.startsWith("audio/") ? currentType : "audio/mpeg";
  }
  if (category === "word") {
    return (
      currentType ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  }
  if (category === "excel") {
    return (
      currentType ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  }
  if (
    category === "pdf" ||
    (category === "document" && currentType === "application/pdf")
  ) {
    return currentType || "application/pdf";
  }
  return null;
}

/** Fetch a URL while invoking onProgress(0-100) as bytes arrive and caching the stream locally */
async function fetchWithProgress(
  url: string,
  onProgress?: (pct: number) => void,
  cacheKey?: string,
  fileSizeBytes?: number,
): Promise<ArrayBuffer> {
  let stream: ReadableStream<Uint8Array>;
  let total = fileSizeBytes || 0;
  let fromCache = false;

  if (cacheKey) {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      stream = cached.body!;
      total = +(cached.headers.get("x-content-length") ?? 0) || total;
      fromCache = true;
      console.log(`[PreviewCache] Cache hit for generic preview: ${cacheKey}`);
    }
  }

  if (!stream!) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch file");

    total = +(res.headers.get("content-length") ?? 0) || total;

    if (cacheKey) {
      const [forCache, forRead] = res.body!.tee();
      storeCachedStream(cacheKey, forCache, total).catch(() => {});
      stream = forRead;
    } else {
      stream = res.body!;
    }
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (fromCache && onProgress) {
    onProgress(100);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && !fromCache && onProgress) {
      onProgress(Math.round((received / total) * 100));
    }
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export function FilePreviewDialog({
  file,
  isOpen,
  onClose,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  sharedToken,
  albumShareToken,
  shareKey,
  password,
  directShareId,
  sourceContext: explicitSourceContext,
  intent = "preview",
  directShareWrappedKey,
  sharedItemId,
  onDownload,
}: FilePreviewDialogProps) {
  const sourceContext: PreviewSourceContext =
    explicitSourceContext ??
    (albumShareToken
      ? "album"
      : sharedToken || directShareId
        ? "public-share"
        : "owned");
  const [url, setUrl] = useState<string | null>(null);
  const cryptoControl = useOptionalCrypto();
  const downloadControl = useOptionalDownload();

  const privateKey = cryptoControl?.privateKey;
  const metadataKey = cryptoControl?.metadataKey;
  const workspace = useOptionalWorkspace();
  const workspaceSpaceKey = useWorkspaceSpaceKey();
  const activeMetadataKey = workspaceSpaceKey.cryptoKey ?? metadataKey;
  const setModalOpen = cryptoControl?.setModalOpen ?? NOOP;
  const isUnlocked = cryptoControl?.isUnlocked ?? false;

  const startDownload = downloadControl?.startDownload;
  const [loading, setLoading] = useState(true);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [disposition, setDisposition] = useState<PreviewDisposition | null>(
    null,
  );
  const [error, setError] = useState("");
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [streamOpts, setStreamOpts] = useState<VideoStreamOptions | null>(null);
  const [audioTracks, setAudioTracks] = useState<SidecarAudioTrack[]>([]);
  const [streamDek, setStreamDek] = useState<CryptoKey | null>(null);
  const [loadingMessage, setLoadingMessage] =
    useState<string>("Loading preview...");
  const [progress, setProgress] = useState<number | null>(null);
  const [isVideoPreparing, setIsVideoPreparing] = useState(false);
  const [decryptedName, setDecryptedName] = useState<string | null>(null);
  const [decryptedContentType, setDecryptedContentType] = useState<
    string | null
  >(null);
  const [fetchedData, setFetchedData] = useState<ObjectData | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  // HD / original-quality preview. The main preview loads the optimized
  // version; `wantHd` lazily loads + decrypts the ORIGINAL into `hdUrl` and
  // swaps it in once ready (without disrupting the visible image).
  const [wantHd, setWantHd] = useState(false);
  const [hdUrl, setHdUrl] = useState<string | null>(null);
  const [hdLoading, setHdLoading] = useState(false);
  const mediaSessionRef = useRef<ServiceWorkerMediaSession | null>(null);
  const mediaInspectionRef = useRef<{
    key: string;
    promise: Promise<{ ciphertext: ArrayBuffer; plaintext: ArrayBuffer }>;
  } | null>(null);
  const hdObjectUrlRef = useRef<string | null>(null);
  const hdRequestedRef = useRef(false);

  const objectUrlRef = useRef<string | null>(null);
  const { renderers: rendererFlags, refresh: refreshRendererConfig } =
    useRendererConfig();
  const previewContentType = decryptedContentType || file?.contentType || "";
  const previewMediaCategory =
    fetchedData?.mediaCategory || file?.mediaCategory;
  const isVisualPreview =
    previewContentType.startsWith("image/") ||
    previewContentType.startsWith("video/") ||
    previewMediaCategory === "image" ||
    previewMediaCategory === "video";
  const isVideoPreview =
    previewContentType.startsWith("video/") || previewMediaCategory === "video";

  const isLockedOut =
    !sharedToken && !directShareId && file?.isEncrypted && !privateKey;

  const inspectForPreview = useCallback(
    async (
      bytes: Uint8Array,
      name: string,
      suppliedMime: string,
      size: number,
    ) => {
      const currentConfig = await refreshRendererConfig();
      const { budget, capabilities } = getPreviewRuntimeProfile();
      const inspected = inspectFileHeader(bytes, name, suppliedMime, size);
      const nextDisposition = decideFileDisposition(
        inspected,
        sourceContext,
        intent,
        currentConfig.renderers,
        capabilities,
        budget,
      );
      return {
        disposition: nextDisposition,
        budget,
        detectedMime: inspected.detectedMime || suppliedMime,
      };
    },
    [intent, refreshRendererConfig, sourceContext],
  );

  useEffect(() => {
    if (isOpen && isLockedOut) {
      setModalOpen(true);
      onClose();
    }
  }, [isOpen, isLockedOut, setModalOpen, onClose]);
  useEffect(() => {
    if (!isOpen || !disposition) return;
    if (isDispositionRendererEnabled(disposition, rendererFlags)) return;
    mediaSessionRef.current?.close();
    mediaSessionRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setUrl(null);
    setPreviewBlob(null);
    setStreamOpts(null);
    setStreamDek(null);
    setIsVideoPreparing(false);
    setDisposition({
      action: "download-only",
      reason: "This renderer was disabled by the security kill switch",
    });
  }, [disposition, isOpen, rendererFlags]);

  // Keyboard arrow navigation
  useEffect(() => {
    if (!isOpen || isMinimized) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;

      if (e.key === "ArrowLeft" && hasPrevious && onPrevious) {
        e.preventDefault();
        onPrevious();
      } else if (e.key === "ArrowRight" && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isMinimized, hasPrevious, hasNext, onPrevious, onNext]);

  useEffect(() => {
    if (!isOpen) {
      mediaSessionRef.current?.close();
      mediaSessionRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setUrl(null);
      setPreviewBlob(null);
      setDisposition(null);
      setError("");
      setIsEncrypted(false);
      setIsMinimized(false);
      setStreamOpts(null);
      setAudioTracks([]);
      setStreamDek(null);
      setLoadingMessage("Loading preview...");
      setProgress(null);
      setIsVideoPreparing(false);
      setFetchedData(null);
    }
  }, [isOpen]);

  // Reset HD state whenever the file changes or the dialog closes, and revoke
  // the original-quality blob URL so it doesn't leak across navigations.
  useEffect(() => {
    mediaInspectionRef.current = null;
    setWantHd(false);
    setHdLoading(false);
    setHdUrl(null);
    hdRequestedRef.current = false;
    if (hdObjectUrlRef.current) {
      URL.revokeObjectURL(hdObjectUrlRef.current);
      hdObjectUrlRef.current = null;
    }
  }, [file?.id, isOpen]);

  useEffect(() => {
    setDecryptedName(null);
    setDecryptedContentType(null);

    if (!file || !isUnlocked || !file.isEncrypted) {
      return;
    }

    let cancelled = false;
    async function decryptMeta() {
      if (!file) return;

      try {
        if (file.encryptedName) {
          const name = await decryptMetadataString(
            file.encryptedName,
            activeMetadataKey ?? null,
          );
          if (!cancelled) setDecryptedName(name);
        }
      } catch (e) {
        console.error("Failed to decrypt preview metadata", e);
      }
    }
    decryptMeta();

    return () => {
      cancelled = true;
    };
  }, [file, isUnlocked, activeMetadataKey]);

  useEffect(() => {
    if (!isOpen || !fetchedData) return;

    let cancelled = false;
    /*
    async function discoverTracks() {
      // --- Audio Track Discovery (Unified) ---
      const sidecarAudio =
        fetchedData.sidecars?.filter((s) => s.mediaCategory === "audio") || [];
      console.log(sidecarAudio);

      let tracks: SidecarAudioTrack[] = [
        {
          id: "internal-0",
          language: "Default",
          title: "Internal Audio",
        },
        ...sidecarAudio.map((s, idx) => ({
          id: s.id,
          objectId: s.id,
          language: `Track ${idx + 2}`,
          title: `Sidecar ${idx + 1}`,
        })),
      ];

      if (fetchedData.encryptedMetadata && metadataKey) {
        try {
          const { decryptMetadataObject } =
            await import("@/lib/crypto/fileEncryption");
          const decoded = await decryptMetadataObject(
            fetchedData.encryptedMetadata,
            metadataKey,
          );

          if (decoded?.audioTracks && decoded.audioTracks.length > 0) {
            tracks = tracks.map((track, idx) => {
              const meta = decoded.audioTracks[idx];
              if (meta) {
                return {
                  ...track,
                  language: meta.language || track.language,
                  title: meta.title || track.title,
                };
              }
              return track;
            });
          }
        } catch (e) {
          console.warn("[Preview] Failed to enrich track labels", e);
        }
      }

      if (tracks.length > 1 && !cancelled) {
        console.log("tracks", tracks);
        setAudioTracks(tracks);
      }
    }

    discoverTracks();
    */
    return () => {
      cancelled = true;
    };
  }, [isOpen, fetchedData, metadataKey]);

  useEffect(() => {
    let cancelled = false;
    let createdMediaSession: ServiceWorkerMediaSession | null = null;

    async function run() {
      if (!isOpen || !file || isLockedOut) return;
      mediaSessionRef.current?.close();
      mediaSessionRef.current = null;

      setLoading(true);
      setLoadingMessage("Fetching metadata...");
      setError("");
      setUrl(null);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setPreviewBlob(null);
      setDisposition(null);
      setStreamOpts(null);
      setStreamDek(null);
      setProgress(null);
      setIsVideoPreparing(false);

      try {
        let res;
        if (directShareId) {
          res = await fetch(`/api/direct-shares/${directShareId}/stream`, {
            method: "POST",
          });
        } else if (albumShareToken) {
          res = await fetch(
            `/api/album-share/${albumShareToken}/objects/${file.id}/stream`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: password || undefined }),
            },
          );
        } else if (sharedToken) {
          res = await fetch(`/api/share/${sharedToken}/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password: password || undefined,
              itemId: sharedItemId,
            }),
          });
        } else {
          res = workspace?.scopedFetch
            ? await workspace.scopedFetch(
                `/api/objects/${file.id}?preview=true`,
              )
            : await fetch(`/api/objects/${file.id}?preview=true`);
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to get metadata");
        }
        const data = await res.json();
        if (!cancelled) setFetchedData(data);
        if (
          !data?.url &&
          !data?.streamUrl &&
          (!data?.chunkUrls || data.chunkUrls.length === 0)
        )
          throw new Error("No URL returned");

        const encrypted: boolean = data.isEncrypted ?? false;

        let shareKeyObj: CryptoKey | null = null;
        let type =
          (sharedToken || directShareId) && data.shareEncryptedContentType
            ? file.contentType
            : (data.contentType ?? file.contentType);

        if (directShareId && directShareWrappedKey && privateKey) {
          const rawShareKey = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            fromB64(directShareWrappedKey).buffer as ArrayBuffer,
          );
          shareKeyObj = await crypto.subtle.importKey(
            "raw",
            rawShareKey,
            { name: "AES-GCM" },
            false,
            ["decrypt", "unwrapKey"],
          );
        }

        if (sharedToken && shareKey) {
          const skBytes = fromB64(
            shareKey
              .replace(/-/g, "+")
              .replace(/_/g, "/")
              .padEnd(shareKey.length + ((4 - (shareKey.length % 4)) % 4), "="),
          );
          shareKeyObj = await crypto.subtle.importKey(
            "raw",
            skBytes,
            { name: "AES-GCM" },
            false,
            ["decrypt", "unwrapKey"],
          );
        }

        if (
          (sharedToken || directShareId) &&
          shareKeyObj &&
          data.shareEncryptedContentType
        ) {
          try {
            type = await decryptWithShareKey(
              data.shareEncryptedContentType,
              shareKeyObj,
            );
            if (!cancelled) setDecryptedContentType(type);
          } catch (e) {
            console.warn(
              "Failed to decrypt shared content type, falling back",
              e,
            );
          }
        }

        if (
          type === "application/octet-stream" &&
          data.encryptedContentType &&
          activeMetadataKey
        ) {
          try {
            type = await decryptMetadataString(
              data.encryptedContentType,
              activeMetadataKey,
            );
            if (!cancelled) setDecryptedContentType(type);
          } catch (e) {
            console.warn(
              "Failed to decrypt content type, staying as octet-stream",
              e,
            );
          }
        } else {
          if (!cancelled) setDecryptedContentType(type);
        }

        if (type === "application/octet-stream" || !type) {
          const fileName =
            decryptedName || file.name || fileNameFromKey(file.key);
          type =
            inferContentTypeFromName(fileName) ||
            inferContentTypeFromCategory(
              data.mediaCategory || file.mediaCategory,
              type,
            ) ||
            type;
          if (!cancelled) setDecryptedContentType(type);
        }

        const openingConfig = await refreshRendererConfig();
        const { budget: openingBudget } = getPreviewRuntimeProfile();
        if (!openingConfig.renderers.global) {
          if (!cancelled) {
            setDisposition({
              action: "download-only",
              reason: "Preview system is disabled",
            });
          }
          return;
        }
        if (file.size > openingBudget.maxInputBytes) {
          if (!cancelled) {
            setDisposition({
              action: "download-only",
              reason: "File exceeds the preview resource budget",
            });
          }
          return;
        }

        if (!encrypted) {
          if (!cancelled) {
            setDisposition({
              action: "download-only",
              reason: "Unencrypted legacy objects are not previewed",
            });
            setIsEncrypted(false);
          }
          return;
        }

        setIsEncrypted(true);

        // --- DEK Derivation ---
        let rawDEK: ArrayBuffer;
        let directShareDEK: CryptoKey | null = null;
        if (directShareId && shareKeyObj) {
          if (!data.shareEncryptedDEK || !data.shareKeyIv) {
            throw new Error("Missing direct share decryption metadata.");
          }

          directShareDEK = await crypto.subtle.unwrapKey(
            "raw",
            fromB64(data.shareEncryptedDEK).buffer as ArrayBuffer,
            shareKeyObj,
            {
              name: "AES-GCM",
              iv: fromB64(data.shareKeyIv).buffer as ArrayBuffer,
            },
            { name: "AES-GCM" },
            true,
            ["decrypt"],
          );
          rawDEK = await crypto.subtle.exportKey("raw", directShareDEK);
        } else if (sharedToken && shareKey && shareKeyObj) {
          const encryptedDekBytes = fromB64(
            data.shareEncryptedDEK || data.encryptedDEK,
          );
          const ivBytes = fromB64(data.shareKeyIv);

          rawDEK = await crypto.subtle
            .unwrapKey(
              "raw",
              encryptedDekBytes,
              shareKeyObj,
              { name: "AES-GCM", iv: ivBytes },
              { name: "AES-GCM" },
              true,
              ["decrypt"],
            )
            .then((key) => crypto.subtle.exportKey("raw", key));
        } else if (data.wrappedBy === "space") {
          if (!data.spaceKeyWrapIv) {
            throw new Error("Workspace key unavailable. Please unlock first.");
          }
          if (!workspaceSpaceKey.rawSpaceKey) {
            // The workspace space key loads asynchronously once the org/team
            // scope resolves. Wait for it instead of failing the preview — this
            // effect re-runs when rawSpaceKey / error / loading state changes.
            if (
              workspaceSpaceKey.isWorkspaceEncrypted &&
              workspaceSpaceKey.isLoading
            ) {
              return;
            }
            if (
              workspaceSpaceKey.isWorkspaceEncrypted &&
              !workspaceSpaceKey.error
            ) {
              return;
            }
            if (!privateKey) setModalOpen(true);
            throw new Error("Workspace key unavailable. Please unlock first.");
          }
          const dek = await unwrapDEKWithSpaceKey(
            data.encryptedDEK,
            data.spaceKeyWrapIv,
            workspaceSpaceKey.rawSpaceKey,
          );
          rawDEK = await crypto.subtle.exportKey("raw", dek);
        } else if (privateKey) {
          rawDEK = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            fromB64(data.encryptedDEK),
          );
        } else if (sharedToken) {
          // If we are in shared mode but lack a key, just wait for it (it might be coming from a hash sync)
          if (!shareKey) return;
          throw new Error("Invalid share key or missing decryption metadata.");
        } else {
          setModalOpen(true);
          throw new Error(
            "Your files are encrypted. Please unlock your vault or provide a valid share key.",
          );
        }

        // --- Path B: inspected chunked media streaming ---
        if (data.chunkUrls && data.chunkUrls.length > 0) {
          setLoadingMessage("Inspecting decrypted media header...");
          const dek = await crypto.subtle.importKey(
            "raw",
            rawDEK,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"],
          );
          const chunkIvs: string[] =
            typeof data.chunkIvs === "string"
              ? JSON.parse(data.chunkIvs)
              : data.chunkIvs;
          if (
            !Array.isArray(chunkIvs) ||
            chunkIvs.length !== data.chunkUrls.length
          ) {
            throw new Error("Invalid encrypted chunk metadata");
          }

          const inspectionKey = `${file.id}:${chunkIvs[0]}`;
          let inspection = mediaInspectionRef.current;
          if (!inspection || inspection.key !== inspectionKey) {
            const promise = (async () => {
              const response = await fetch(data.chunkUrls[0]);
              if (!response.ok) {
                throw new Error(
                  `Failed to inspect media: HTTP ${response.status}`,
                );
              }
              const ciphertext = await response.arrayBuffer();
              const plaintext = await decryptChunk(
                ciphertext,
                dek,
                chunkIvs[0],
              );
              return { ciphertext, plaintext };
            })();
            inspection = { key: inspectionKey, promise };
            mediaInspectionRef.current = inspection;
            void promise.catch(() => {
              if (mediaInspectionRef.current?.promise === promise) {
                mediaInspectionRef.current = null;
              }
            });
          }
          const { ciphertext: firstCiphertext, plaintext: firstPlaintext } =
            await inspection.promise;
          const previewName =
            decryptedName || file.name || fileNameFromKey(file.key);
          const approved = await inspectForPreview(
            new Uint8Array(firstPlaintext).slice(0, 1024 * 1024),
            previewName,
            type,
            file.size,
          );
          if (cancelled) return;

          setDisposition(approved.disposition);
          if (approved.disposition.action !== "safe-media") {
            return;
          }

          setDecryptedContentType(approved.detectedMime);
          try {
            setLoadingMessage("Starting encrypted range stream...");
            const mediaSession = await createServiceWorkerMediaSession({
              urls: data.chunkUrls,
              rawDEK,
              chunkSize: data.chunkSize || 2 * 1024 * 1024,
              chunkCount: data.chunkCount || data.chunkUrls.length,
              chunkIvs,
              contentType: approved.detectedMime,
              cipherSize: file.size,
              initialCiphertext: firstCiphertext,
            });
            if (cancelled) {
              mediaSession.close();
              return;
            }

            createdMediaSession = mediaSession;
            mediaSessionRef.current = mediaSession;
            setStreamDek(dek);
            setStreamOpts(null);
            setUrl(mediaSession.url);
            setIsVideoPreparing(true);
            setLoadingMessage("Streaming encrypted media...");
            setLoading(false);
            return;
          } catch (serviceWorkerError) {
            console.warn(
              "[Preview] Native range streaming unavailable; using MSE fallback",
              serviceWorkerError,
            );
          }

          setStreamDek(dek);
          setStreamOpts({
            urls: data.chunkUrls,
            dek,
            chunkSize: data.chunkSize || 2 * 1024 * 1024,
            chunkCount: data.chunkCount || data.chunkUrls.length,
            chunkIvs,
            contentType: approved.detectedMime,
          });
          setIsVideoPreparing(true);
          setLoadingMessage("Fetching initial chunks...");
          setLoading(false);
          return;
        }

        // --- Path C: Full Blob Decryption ---
        setLoadingMessage("Downloading encrypted file...");
        const ciphertextBuf = await fetchWithProgress(
          data.url || data.streamUrl,
          (pct) => {
            if (!cancelled) setProgress(pct);
          },
          directShareId
            ? `direct-share-${directShareId}-${file.id}`
            : `${file.id}-${data.iv || ""}`,
          file.size,
        );

        if (!cancelled) {
          setProgress(null);
          setLoadingMessage("Decrypting file...");
        }

        let decryptedBlob: Blob;
        const dek =
          directShareDEK ||
          (await crypto.subtle.importKey(
            "raw",
            rawDEK,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"],
          ));

        if (data.chunkIvs && data.chunkSize && data.chunkCount) {
          decryptedBlob = await decryptFileChunkedCombined(
            ciphertextBuf,
            null, // specify null so it uses the dek we pass below
            data.chunkIvs,
            data.chunkSize,
            data.chunkCount,
            dek,
            type,
          );
        } else {
          decryptedBlob = await decryptFileWithDEK(
            ciphertextBuf,
            dek,
            data.iv,
            type,
          );
        }

        const previewName =
          decryptedName || file.name || fileNameFromKey(file.key);
        const inspectionBytes = new Uint8Array(
          await decryptedBlob.slice(0, 1024 * 1024).arrayBuffer(),
        );
        const approved = await inspectForPreview(
          inspectionBytes,
          previewName,
          type,
          decryptedBlob.size,
        );
        if (cancelled) return;

        setDisposition(approved.disposition);
        if (
          approved.disposition.action === "safe-image" ||
          approved.disposition.action === "safe-media" ||
          approved.disposition.action === "pdf-canvas" ||
          approved.disposition.action === "safe-text"
        ) {
          const safeBlob = decryptedBlob.slice(
            0,
            decryptedBlob.size,
            approved.detectedMime,
          );
          setPreviewBlob(safeBlob);
          setDecryptedContentType(approved.detectedMime);

          if (
            approved.disposition.action === "safe-image" ||
            approved.disposition.action === "safe-media"
          ) {
            const objectUrl = URL.createObjectURL(safeBlob);
            objectUrlRef.current = objectUrl;
            setUrl(objectUrl);
          }
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Failed to load preview. Please try downloading instead.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      if (createdMediaSession) {
        createdMediaSession.close();
        if (mediaSessionRef.current === createdMediaSession) {
          mediaSessionRef.current = null;
        }
      }
    };
  }, [
    isOpen,
    file,
    privateKey,
    isLockedOut,
    setModalOpen,
    metadataKey,
    activeMetadataKey,
    workspace,
    workspaceSpaceKey.rawSpaceKey,
    workspaceSpaceKey.isWorkspaceEncrypted,
    workspaceSpaceKey.isLoading,
    workspaceSpaceKey.error,
    sharedToken,
    sharedItemId,
    albumShareToken,
    shareKey,
    password,
    directShareId,
    directShareWrappedKey,
    decryptedName,
    inspectForPreview,
    refreshRendererConfig,
  ]);

  // ── HD / original-quality loader (owned image files) ─────────────────────
  // Fetches + decrypts the ORIGINAL in the background when the user taps "HD"
  // or zooms in. The optimized image stays on screen until this resolves, then
  // it swaps in seamlessly (zoom preserved). Owned files only — shared links
  // serve their own optimized stream.
  useEffect(() => {
    // Ref guard (not hdLoading/hdUrl state) so flipping loading state inside
    // the effect doesn't re-trigger it and cancel the in-flight request.
    if (!wantHd || hdRequestedRef.current) return;
    if (sharedToken || albumShareToken || directShareId || !file) return;
    const t = decryptedContentType || file.contentType || "";
    if (!t.startsWith("image/")) return;

    hdRequestedRef.current = true;
    let cancelled = false;
    (async () => {
      setHdLoading(true);
      try {
        // No `preview` param → backend serves the original (full-res) key.
        const res = workspace?.scopedFetch
          ? await workspace.scopedFetch(`/api/objects/${file.id}`)
          : await fetch(`/api/objects/${file.id}`);
        if (!res.ok) throw new Error("Failed to load original");
        const data = await res.json();
        const originalName =
          decryptedName || file.name || fileNameFromKey(file.key);

        // `decryptedContentType` describes the image currently on screen. When
        // the API served an optimized preview that value can be `image/webp`
        // even though this request returns the original JPEG/PNG bytes. Recover
        // the original MIME metadata instead so the hostile-file inspector
        // compares the original signature with the original declaration.
        let type =
          data.contentType || file.contentType || "application/octet-stream";
        if (data.encryptedContentType && activeMetadataKey) {
          try {
            type = await decryptMetadataString(
              data.encryptedContentType,
              activeMetadataKey,
            );
          } catch (metadataError) {
            console.warn(
              "Failed to decrypt original content type, using safe fallback",
              metadataError,
            );
          }
        }
        if (!type || type === "application/octet-stream") {
          type =
            inferContentTypeFromName(originalName) ||
            inferContentTypeFromCategory(
              data.mediaCategory || file.mediaCategory,
              type,
            ) ||
            "application/octet-stream";
        }

        if (!data.isEncrypted) {
          throw new Error("Unencrypted originals are not previewed");
        }
        let rawDEK: ArrayBuffer;
        if (data.wrappedBy === "space") {
          if (!data.spaceKeyWrapIv) {
            throw new Error("Workspace key unavailable");
          }
          if (!workspaceSpaceKey.rawSpaceKey) {
            // Space key still resolving — allow a retry once it lands rather
            // than tearing down the HD load permanently.
            hdRequestedRef.current = false;
            return;
          }
          const unwrapped = await unwrapDEKWithSpaceKey(
            data.encryptedDEK,
            data.spaceKeyWrapIv,
            workspaceSpaceKey.rawSpaceKey,
          );
          rawDEK = await crypto.subtle.exportKey("raw", unwrapped);
        } else {
          if (!privateKey) throw new Error("Vault locked");
          rawDEK = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            fromB64(data.encryptedDEK),
          );
        }
        const dek = await crypto.subtle.importKey(
          "raw",
          rawDEK,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        let buf: ArrayBuffer;
        if (Array.isArray(data.chunkUrls) && data.chunkUrls.length > 0) {
          const ciphertextChunks: ArrayBuffer[] = [];
          let totalCiphertextBytes = 0;
          for (const chunkUrl of data.chunkUrls as string[]) {
            const chunkResponse = await fetch(chunkUrl);
            if (!chunkResponse.ok) {
              throw new Error(
                `Failed to load original image chunk: HTTP ${chunkResponse.status}`,
              );
            }
            const chunk = await chunkResponse.arrayBuffer();
            ciphertextChunks.push(chunk);
            totalCiphertextBytes += chunk.byteLength;
          }
          const combined = new Uint8Array(totalCiphertextBytes);
          let offset = 0;
          for (const chunk of ciphertextChunks) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          buf = combined.buffer;
        } else {
          if (!data.url) throw new Error("No original image URL returned");
          buf = await fetchWithProgress(
            data.url,
            undefined,
            `${file.id}-original-${data.iv || ""}`,
            file.size,
          );
        }
        let blob: Blob;
        if (data.chunkIvs && data.chunkSize && data.chunkCount) {
          blob = await decryptFileChunkedCombined(
            buf,
            null,
            data.chunkIvs,
            data.chunkSize,
            data.chunkCount,
            dek,
            type,
          );
        } else {
          blob = await decryptFileWithDEK(buf, dek, data.iv, type);
        }
        const inspectionBytes = new Uint8Array(
          await blob.slice(0, 1024 * 1024).arrayBuffer(),
        );
        const approved = await inspectForPreview(
          inspectionBytes,
          originalName,
          type,
          blob.size,
        );
        if (approved.disposition.action !== "safe-image") {
          throw new Error(approved.disposition.reason);
        }
        const safeBlob = blob.slice(0, blob.size, approved.detectedMime);
        const objUrl = URL.createObjectURL(safeBlob);
        hdObjectUrlRef.current = objUrl;
        if (!cancelled) setHdUrl(objUrl);
      } catch (e) {
        console.error("[Preview] HD/original load failed", e);
        if (!cancelled) setWantHd(false);
        hdRequestedRef.current = false; // allow a retry
      } finally {
        if (!cancelled) setHdLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    wantHd,
    sharedToken,
    sharedItemId,
    directShareId,
    file,
    privateKey,
    decryptedContentType,
    workspace,
    workspaceSpaceKey.rawSpaceKey,
    albumShareToken,
    inspectForPreview,
    decryptedName,
    activeMetadataKey,
  ]);

  if (!file) return null;

  const name = decryptedName || file.name || fileNameFromKey(file.key);
  const type = decryptedContentType || file.contentType || "";

  // HD applies to owned image files (shared links serve their own stream).
  const canHd =
    disposition?.action === "safe-image" &&
    !sharedToken &&
    !albumShareToken &&
    !directShareId;

  // Version history is an owner-only feature (not for shared/album/direct views).
  const canVersions = !sharedToken && !albumShareToken && !directShareId;

  const handleDownload = async () => {
    if (directShareId) {
      onDownload?.();
      return;
    }

    // Public album share: anonymous visitors have no vault, so decrypt with the
    // per-photo DEK wrapped under the album share key (carried in the URL).
    if (albumShareToken && file) {
      try {
        const res = await fetch(
          `/api/album-share/${albumShareToken}/objects/${file.id}/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: password || undefined }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load file");

        const dlName = decryptedName || file.name || fileNameFromKey(file.key);
        const dlType =
          decryptedContentType || data.contentType || file.contentType;
        let blob: Blob;

        if (data.isEncrypted) {
          if (!shareKey || !data.shareEncryptedDEK) {
            throw new Error("Missing decryption key");
          }
          const skBytes = fromB64(
            shareKey
              .replace(/-/g, "+")
              .replace(/_/g, "/")
              .padEnd(shareKey.length + ((4 - (shareKey.length % 4)) % 4), "="),
          );
          const shareKeyObj = await crypto.subtle.importKey(
            "raw",
            skBytes,
            { name: "AES-GCM" },
            false,
            ["unwrapKey"],
          );
          const dek = await crypto.subtle.unwrapKey(
            "raw",
            fromB64(data.shareEncryptedDEK).buffer as ArrayBuffer,
            shareKeyObj,
            {
              name: "AES-GCM",
              iv: fromB64(data.shareKeyIv).buffer as ArrayBuffer,
            },
            { name: "AES-GCM" },
            false,
            ["decrypt"],
          );

          if (data.chunkUrls && data.chunkUrls.length > 0) {
            const chunkIvs: string[] = JSON.parse(data.chunkIvs);
            const parts: ArrayBuffer[] = [];
            for (let i = 0; i < data.chunkUrls.length; i++) {
              const cr = await fetch(data.chunkUrls[i]);
              parts.push(
                await decryptChunk(await cr.arrayBuffer(), dek, chunkIvs[i]),
              );
            }
            blob = new Blob(parts, { type: dlType });
          } else {
            const cipher = await (
              await fetch(data.url || data.streamUrl)
            ).arrayBuffer();
            blob = await decryptFileWithDEK(cipher, dek, data.iv, dlType);
          }
        } else {
          const raw = await (
            await fetch(data.url || data.streamUrl)
          ).arrayBuffer();
          blob = new Blob([raw], { type: dlType });
        }

        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = dlName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        console.error("Album share download failed:", err);
      }
      return;
    }

    if (!file || !startDownload) return;
    try {
      await startDownload(
        {
          id: file.id,
          key: file.key,
          size: file.size,
          contentType: file.contentType,
          encryptedName: file.encryptedName,
        },
        !!file.isEncrypted,
        privateKey,
        activeMetadataKey,
      );
    } catch (err: unknown) {
      console.error("Download failed:", err);
    }
  };

  const openInXenodeSheetsAt = (editorPath: string) => {
    if (!file || sharedToken || albumShareToken) return;
    if (directShareId) {
      // Shared spreadsheets open through the share-authorized editor mode:
      // read-only for viewers/commenters, editable for editor recipients.
      onClose();
      window.location.assign(editorPath + "?shareId=" + directShareId);
      return;
    }
    const params = new URLSearchParams({ id: file.id });
    const scope = workspace?.driveScope;
    if (scope?.type === "organization" || scope?.type === "team") {
      params.set("orgId", scope.orgId);
    }
    if (scope?.type === "team") params.set("teamId", scope.teamId);
    if (file.bucketId) params.set("bucketId", file.bucketId);
    const slash = file.key.lastIndexOf("/");
    if (slash >= 0) params.set("prefix", file.key.slice(0, slash + 1));
    onClose();
    window.location.assign(editorPath + "?" + params.toString());
  };
  const openInIsolatedOfficeEditor = () =>
    openInXenodeSheetsAt("/sheets-v2/editor");
  const renderContent = () => {
    let innerContent = null;

    if (!loading && !error) {
      if (streamOpts) {
        innerContent = (
          <ChunkedStreamPlayer
            opts={streamOpts}
            type={type}
            onUrlChange={(newUrl) => {
              if (newUrl !== url) setUrl(newUrl);
            }}
            onReady={() => setIsVideoPreparing(false)}
            audioTracks={audioTracks}
            dek={streamDek}
            privateKey={privateKey}
            metadataKey={activeMetadataKey}
          />
        );
      } else if (url) {
        if (type.startsWith("image/")) {
          innerContent = (
            <ZoomableImage
              src={wantHd && hdUrl ? hdUrl : url}
              resetKey={file.id}
              alt={name}
              onZoomIn={canHd ? () => setWantHd(true) : undefined}
              onLoad={() => setIsVideoPreparing(false)}
              onError={() => setIsVideoPreparing(false)}
            />
          );
        } else if (type.startsWith("video/") || type.startsWith("audio/")) {
          innerContent = (
            <MemoizedMediaPlayer
              url={url}
              type={type}
              onReady={() => setIsVideoPreparing(false)}
              audioTracks={audioTracks}
              dek={streamDek}
              privateKey={privateKey}
              metadataKey={activeMetadataKey}
            />
          );
        } else if (type === "application/pdf") {
          const { budget } = getPreviewRuntimeProfile();
          innerContent = previewBlob ? (
            <SafePdfPreview
              blob={previewBlob}
              maxPages={budget.maxPdfPages}
              maxPixelsPerPage={Math.min(budget.maxImagePixels, 25_000_000)}
            />
          ) : null;
        } else if (
          type.includes("word") ||
          type.includes("officedocument.wordprocessingml") ||
          type.includes("msword")
        ) {
          innerContent = (
            <div className="grid h-full place-items-center p-6 text-center">
              <p className="text-sm text-muted-foreground">
                This Office format is download-only until its isolated editor is
                enabled.
              </p>
            </div>
          );
        } else if (
          type.includes("excel") ||
          type.includes("spreadsheet") ||
          type.includes("text/csv")
        ) {
          // Direct shares can open in the share-authorized sheets editor;
          // only public-link/album previews stay download-only.
          const isSharePreview = !!(sharedToken || albumShareToken);
          innerContent = (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <AlertCircle className="mb-3 h-10 w-10 text-emerald-500" />
              <p className="text-sm font-medium">
                {isSharePreview
                  ? "Spreadsheet preview unavailable for shared links"
                  : "Open with Xenode Sheets"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                {isSharePreview
                  ? "Download this encrypted spreadsheet to view it locally. Xenode never sends it to Microsoft Office viewers."
                  : "This spreadsheet is edited locally in your browser with end-to-end encryption."}
              </p>
              {isSharePreview ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={handleDownload}
                >
                  Download spreadsheet
                </Button>
              ) : (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" onClick={openInIsolatedOfficeEditor}>
                    Open isolated editor
                  </Button>
                </div>
              )}
            </div>
          );
        } else if (
          type.includes("presentation") ||
          type.includes("powerpoint") ||
          type.includes("text/plain")
        ) {
          innerContent = previewBlob ? (
            <SafeTextPreview blob={previewBlob} />
          ) : null;
        } else {
          innerContent = (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Preview not available</p>
              <p className="text-xs text-muted-foreground mt-1">
                This file type is not supported for preview.
              </p>

              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleDownload}
              >
                Download file
              </Button>
            </div>
          );
        }
      } else if (disposition?.action === "pdf-canvas" && previewBlob) {
        const { budget } = getPreviewRuntimeProfile();
        innerContent = (
          <SafePdfPreview
            blob={previewBlob}
            maxPages={budget.maxPdfPages}
            maxPixelsPerPage={Math.min(budget.maxImagePixels, 25_000_000)}
          />
        );
      } else if (disposition?.action === "safe-text" && previewBlob) {
        innerContent = <SafeTextPreview blob={previewBlob} />;
      } else if (disposition?.action === "office-view-edit") {
        const spreadsheetSupported = /\.(xlsx|ods)$/i.test(name);
        innerContent = (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <AlertCircle className="mb-3 h-10 w-10 text-emerald-500" />
            <p className="text-sm font-medium">Isolated Office editor</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {spreadsheetSupported
                ? "Open this file in the isolated edit.xenode.in runtime."
                : "This Office format remains download-only until its isolated editor is available."}
            </p>
            {spreadsheetSupported ? (
              <Button
                size="sm"
                className="mt-4"
                onClick={openInIsolatedOfficeEditor}
              >
                Open isolated editor
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleDownload}
              >
                Download file
              </Button>
            )}
          </div>
        );
      } else {
        innerContent = (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <AlertCircle className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">Preview not available</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {disposition?.reason ||
                "This file is not in the approved preview set."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={handleDownload}
            >
              Download file
            </Button>
          </div>
        );
      }
    }

    const showLoader = loading || isVideoPreparing;

    return (
      <div className="relative h-full w-full">
        {showLoader && isVisualPreview ? (
          <MediaLoadingPlaceholder
            thumbnailUrl={null}
            isVideo={isVideoPreview}
            progress={progress}
          />
        ) : showLoader ? (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
            <div className="flex flex-col items-center w-full max-w-[200px] text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm font-medium text-foreground">
                {loadingMessage}
              </p>
              {progress !== null && (
                <div className="w-full mt-3 flex flex-col items-center">
                  <Progress value={progress} className="h-1.5 w-full" />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {progress}%
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {!showLoader && hdLoading && type.startsWith("image/") && (
          <TopPreviewLoader progress={null} />
        )}
        {error ? (
          <div className="grid h-full min-h-[40vh] place-items-center px-6 text-center">
            <div className="flex flex-col items-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="mt-3 text-sm text-destructive">{error}</p>
              <div className="mt-5 flex gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">Close</Button>
                </DialogClose>
              </div>
            </div>
          </div>
        ) : (
          innerContent
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose} modal={false}>
        <DialogPortal>
          <DialogOverlay className={isMinimized ? "hidden" : ""} />
          <DialogPrimitive.Content
            onPointerDownOutside={(e) => {
              if (isMinimized) {
                e.preventDefault();
                return;
              }
              const target = e.detail?.originalEvent?.target as HTMLElement;
              if (target && !document.contains(target)) {
                e.preventDefault();
              }
            }}
            onFocusOutside={(e) => {
              e.preventDefault();
            }}
            className={cn(
              "bg-card outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 flex flex-col overflow-hidden border",
              isMinimized
                ? "fixed bottom-4 right-4 z-150 w-80 sm:w-96 rounded-xl shadow-2xl data-[state=open]:slide-in-from-bottom-[20%]"
                : "fixed inset-0 z-150 h-dvh w-screen max-w-none max-h-none rounded-none shadow-lg data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            )}
          >
            {/* Top bar */}
            <div
              className={cn(
                "sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-card/95 backdrop-blur",
                isMinimized ? "px-3 py-2" : "px-4 py-3 sm:px-5",
              )}
            >
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title
                  className={cn(
                    "truncate font-medium flex items-center gap-1.5",
                    isMinimized ? "text-xs" : "text-sm sm:text-base",
                  )}
                >
                  {(isEncrypted || file.isEncrypted) && (
                    <Lock
                      className={cn(
                        "shrink-0 text-primary",
                        isMinimized ? "h-3 w-3" : "h-3.5 w-3.5",
                      )}
                      aria-label="Encrypted"
                    />
                  )}
                  {name}
                </DialogPrimitive.Title>
                {!isMinimized && (
                  <DialogPrimitive.Description className="truncate text-xs text-muted-foreground mt-0.5">
                    {formatMB(file.size)} MB • {type}
                    {(isEncrypted || file.isEncrypted) && " • e2e encrypted"}
                  </DialogPrimitive.Description>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {url && !isMinimized && (
                  <div className="flex items-center gap-1.5 mr-1">
                    {canHd && (
                      <Button
                        variant={wantHd ? "default" : "outline"}
                        size="sm"
                        onClick={() => setWantHd((v) => !v)}
                        className="h-8 gap-1.5"
                        title={
                          wantHd
                            ? "Showing original quality"
                            : "View original (full-resolution) image"
                        }
                      >
                        {hdLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        HD
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownload}
                      className="h-8"
                    >
                      Download
                    </Button>
                  </div>
                )}

                {canVersions && !isMinimized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowVersions(true)}
                    className="h-8 gap-1.5"
                    title="View version history"
                  >
                    <History className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">History</span>
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className={isMinimized ? "h-6 w-6" : "h-8 w-8"}
                  aria-label="Toggle Minimize"
                  onClick={() => setIsMinimized((prev) => !prev)}
                >
                  {isMinimized ? (
                    <Maximize2 className="h-4 w-4" />
                  ) : (
                    <Minimize2 className="h-4 w-4" />
                  )}
                </Button>

                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    className={isMinimized ? "h-6 w-6" : "h-8 w-8"}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </DialogClose>
              </div>
            </div>

            {/* Preview area */}
            <div
              className={cn(
                "overflow-hidden bg-black/5 dark:bg-black/20 flex items-center justify-center relative",
                isMinimized ? "h-48" : "flex-1",
              )}
            >
              <div className="h-full w-full">{renderContent()}</div>

              {/* Side navigation buttons */}
              {hasPrevious && !isMinimized && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-30 h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white backdrop-blur-sm shadow-lg transition-all"
                  onClick={onPrevious}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              )}
              {hasNext && !isMinimized && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-30 h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white backdrop-blur-sm shadow-lg transition-all"
                  onClick={onNext}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      {canVersions && (
        <FileVersionsDialog
          fileId={file.id}
          fileName={name}
          isOpen={showVersions}
          onClose={() => setShowVersions(false)}
          onRestored={() => setShowVersions(false)}
        />
      )}
    </>
  );
}
