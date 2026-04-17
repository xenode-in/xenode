"use client";

const NOOP = () => {};

import React, { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import DocxViewer from "./DocxViewer";
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
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { useOptionalDownload } from "@/contexts/DownloadContext";
import { useOptionalCrypto } from "@/contexts/CryptoContext";
import {
  decryptFileWithDEK,
  decryptFileChunkedCombined,
  decryptMetadataString,
  decryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";
import { useVideoStream, VideoStreamOptions } from "@/hooks/useVideoStream";
import {
  useAudioTrackSyncer,
  SidecarAudioTrack,
} from "@/hooks/useAudioTrackSyncer";

import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "@vidstack/react/player/styles/default/layouts/audio.css";
import { MediaPlayer as VidstackPlayer, MediaProvider } from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
  DefaultAudioLayout,
} from "@vidstack/react/player/layouts/default";
import { DocViewerRenderers } from "@cyntler/react-doc-viewer";

const DocViewer = dynamic(() => import("@cyntler/react-doc-viewer"), {
  ssr: false,
});

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

interface FilePreviewDialogProps {
  file: ObjectData | null;
  isOpen: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  // Shared link specific props
  sharedToken?: string;
  shareKey?: string;
  password?: string;
  directShareId?: string;
  directShareWrappedKey?: string;
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
          if (provider.type === "video") {
            setVideoElement((provider as any).video);
          } else if (provider.type === "audio") {
            setVideoElement((provider as any).audio);
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
  shareKey,
  password,
  directShareId,
  directShareWrappedKey,
  onDownload,
}: FilePreviewDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const cryptoControl = useOptionalCrypto();
  const downloadControl = useOptionalDownload();

  const privateKey = cryptoControl?.privateKey;
  const metadataKey = cryptoControl?.metadataKey;
  const setModalOpen = cryptoControl?.setModalOpen ?? NOOP;
  const isUnlocked = cryptoControl?.isUnlocked ?? false;

  const startDownload = downloadControl?.startDownload;
  const [loading, setLoading] = useState(true);
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

  const objectUrlRef = useRef<string | null>(null);

  const isLockedOut =
    !sharedToken && !directShareId && file?.isEncrypted && !privateKey;

  useEffect(() => {
    if (isOpen && isLockedOut) {
      setModalOpen(true);
      onClose();
    }
  }, [isOpen, isLockedOut, setModalOpen, onClose]);

  // Service Worker registration is now handled at page/layout level
  // ensuring it's ready before the dialog even mounts.

  // Listen to Service Worker broadcast messages for real-time chunk download progress
  useEffect(() => {
    if (!isOpen || !("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "CHUNK_PROGRESS" &&
        event.data?.fileId === file?.id
      ) {
        setProgress(event.data.progress);
        if (event.data.progress >= 100) {
          setLoadingMessage("Decrypting stream...");
        } else {
          setLoadingMessage("Buffering initial stream...");
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, [isOpen, file?.id]);

  useEffect(() => {
    if (!isOpen) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setUrl(null);
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
            metadataKey ?? null,
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
  }, [file, isUnlocked, metadataKey]);

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

    async function run() {
      if (!isOpen || !file || isLockedOut) return;

      setLoading(true);
      setLoadingMessage("Fetching metadata...");
      setError("");
      setUrl(null);
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
        } else if (sharedToken) {
          res = await fetch(`/api/share/${sharedToken}/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: password || undefined }),
          });
        } else {
          res = await fetch(`/api/objects/${file.id}?preview=true`);
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
          metadataKey
        ) {
          try {
            type = await decryptMetadataString(
              data.encryptedContentType,
              metadataKey,
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

        const shouldShowPreparingUI =
          type.startsWith("video/") ||
          type.startsWith("audio/") ||
          type.startsWith("image/") ||
          type === "application/pdf";

        if (!encrypted) {
          if (data.chunkUrls && data.chunkUrls.length > 0) {
            if (!cancelled) {
              setStreamOpts({
                urls: data.chunkUrls,
                dek: null,
                chunkSize: data.chunkSize || 2 * 1024 * 1024,
                chunkCount: data.chunkCount || data.chunkUrls.length,
                chunkIvs: [],
                contentType: type,
              });
              setLoadingMessage("Fetching initial chunks...");
              if (shouldShowPreparingUI) setIsVideoPreparing(true);
              setLoading(false);
            }
          } else {
            if (!cancelled) {
              setUrl(data.url || "");
              setIsEncrypted(false);
            }
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

        // --- Path B: Chunked Streaming ---
        if (data.chunkUrls && data.chunkUrls.length > 0) {
          setLoadingMessage("Preparing decryption...");

          if (!cancelled) {
            if ("serviceWorker" in navigator) {
              try {
                console.log("[Preview] Attempting SW streaming for:", file.id);
                setLoadingMessage("Preparing stream...");
                const registration = await navigator.serviceWorker.ready;
                const sw = registration.active;

                if (sw) {
                  await new Promise<void>((resolve, reject) => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => {
                      if (event.data.success) {
                        console.log("[Preview] SW registration successful");
                        resolve();
                      } else {
                        reject(new Error("Failed to register stream with SW"));
                      }
                    };
                    sw.postMessage(
                      {
                        type: "REGISTER_STREAM",
                        fileId: file.id,
                        rawDEK,
                        chunkSize: data.chunkSize || 2 * 1024 * 1024,
                        chunkCount: data.chunkCount || data.chunkUrls.length,
                        chunkIvs: data.chunkIvs
                          ? JSON.parse(data.chunkIvs)
                          : [],
                        urls: data.chunkUrls,
                        contentType: type,
                        size: file.size,
                      },
                      [channel.port2],
                    );
                  });

                  if (!cancelled) {
                    setLoadingMessage("Buffering initial stream...");
                    setProgress(0);
                    if (shouldShowPreparingUI) setIsVideoPreparing(true);
                    setUrl(`/sw/objects/${file.id}`);
                    setLoading(false);
                    return;
                  }
                }
              } catch (err) {
                console.warn(
                  "[Preview] SW streaming failed, falling back to MSE",
                  err,
                );
              }
            }
            console.log("[Preview] Using MSE fallback mode");

            const dek = await crypto.subtle.importKey(
              "raw",
              rawDEK,
              { name: "AES-GCM", length: 256 },
              false,
              ["decrypt"],
            );

            if (data.chunkUrls && data.chunkUrls.length > 0) {
              if (!cancelled) setStreamDek(dek);

              setStreamOpts({
                urls: data.chunkUrls,
                dek,
                chunkSize: data.chunkSize || 2 * 1024 * 1024,
                chunkCount: data.chunkCount || data.chunkUrls.length,
                chunkIvs: data.chunkIvs ? JSON.parse(data.chunkIvs) : [],
                contentType: type,
              });
              if (shouldShowPreparingUI) setIsVideoPreparing(true);
              setLoadingMessage("Fetching initial chunks...");
              setLoading(false);
            }
          }
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

        const objectUrl = URL.createObjectURL(decryptedBlob);
        objectUrlRef.current = objectUrl;

        if (!cancelled) setUrl(objectUrl);
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
    };
  }, [
    isOpen,
    file,
    privateKey,
    isLockedOut,
    setModalOpen,
    metadataKey,
    sharedToken,
    shareKey,
    password,
    directShareId,
    directShareWrappedKey,
    decryptedName,
  ]);

  if (!file) return null;

  const name = decryptedName || file.name || fileNameFromKey(file.key);
  const type = decryptedContentType || file.contentType;

  const handleDownload = async () => {
    if (directShareId) {
      onDownload?.();
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
        metadataKey,
      );
    } catch (err: unknown) {
      console.error("Download failed:", err);
    }
  };

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
            metadataKey={metadataKey}
          />
        );
      } else if (url) {
        if (type.startsWith("image/")) {
          innerContent = (
            <div className="grid h-full place-items-center bg-black/40 p-2 sm:p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={name}
                className="max-h-[calc(100dvh-8.5rem)] w-auto max-w-full object-contain"
                onLoad={() => setIsVideoPreparing(false)}
                onError={() => setIsVideoPreparing(false)}
              />
            </div>
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
              metadataKey={metadataKey}
            />
          );
        } else if (type === "application/pdf") {
          innerContent = (
            <div className="h-full w-full bg-white">
              <iframe
                src={url}
                className="h-full w-full border-0"
                title={name}
                onLoad={() => setIsVideoPreparing(false)}
                onError={() => setIsVideoPreparing(false)}
              />
            </div>
          );
        } else if (
          type.includes("word") ||
          type.includes("officedocument.wordprocessingml") ||
          type.includes("msword")
        ) {
          innerContent = <DocxViewer url={url} name={name} />;
        } else if (
          type.includes("excel") ||
          type.includes("spreadsheet") ||
          type.includes("presentation") ||
          type.includes("powerpoint") ||
          type.includes("text/plain") ||
          type.includes("text/csv")
        ) {
          innerContent = (
            <div className="h-full w-full doc-viewer-wrapper">
              <DocViewer
                documents={[{ uri: url, fileType: type, fileName: name }]}
                pluginRenderers={DocViewerRenderers}
                style={{ height: "100%" }}
                config={{
                  header: {
                    disableHeader: true,
                    disableFileName: true,
                    retainURLParams: false,
                  },
                }}
              />
            </div>
          );
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
      }
    }

    const showLoader = loading || isVideoPreparing;

    return (
      <div className="relative h-full w-full">
        {showLoader && (
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
              : "fixed inset-0 sm:top-[50%] sm:left-[50%] z-150 w-full max-w-full sm:max-w-5xl lg:max-w-6xl h-dvh sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] rounded-none sm:rounded-xl shadow-lg data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
              {hasPrevious && !isMinimized && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={onPrevious}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              {hasNext && !isMinimized && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={onNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              {url && !isMinimized && (
                <div className="flex items-center gap-1.5 mr-1">
                  {type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const editorUrl = window.location.hostname === "localhost" 
                          ? `http://docs.localhost:3000/?id=${file.id}` 
                          : `https://docs.xenode.in/?id=${file.id}`;
                        window.open(editorUrl, "_blank");
                      }}
                      className="h-8 gap-1.5 text-primary hover:text-primary hover:bg-primary/10"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Edit</span>
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
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
