"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  encryptFile,
  encryptFileChunked,
  encryptMetadataString,
  encryptMetadataObject,
  encryptThumbnail,
} from "@/lib/crypto/fileEncryption";
import { failClosedOnEncryptionError } from "@/lib/crypto/encryptionPolicy";
import { extractMetadata } from "@/lib/metadata/extractor";
import type { FileMetadata } from "@/lib/metadata/types";
import { optimizeVideoForStreaming } from "@/lib/video/faststart";
import { generatePreview } from "@/lib/images/optimizer";
import { upsertLocalObject } from "@/lib/db/object-cache";
import type { UploadRecord } from "@/lib/db/local";
import {
  saveUploadRecord,
  markChunkComplete,
  listUploadRecords,
  deleteUploadRecord,
  requestPersistentStorage,
} from "@/lib/uploads/persistence";

export interface UploadTask {
  id: string;
  file: File;
  bucketId: string;
  prefix: string;
  status: "pending" | "uploading" | "paused" | "completed" | "failed";
  progress: number;
  error?: string;
  statusText?: string;
  /** True once a persisted record exists whose bytes can no longer be recovered
   * (e.g. rehydrated after a reload but the file was over the resume cap). */
  interrupted?: boolean;
}

interface UploadContextType {
  tasks: UploadTask[];
  isPaused: boolean;
  addTasks: (files: File[], bucketId: string, prefix: string) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  clearCompleted: () => void;
  pauseAll: () => void;
  resumeAll: () => void;
  retryTask: (id: string) => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const MAX_CONCURRENT_UPLOADS = 5;

// Persist encrypted bytes for resume-after-reload only up to this size. Larger
// files stay resumable while the tab is open (pause/resume) but are not written
// to IndexedDB — storing e.g. a 1 GB video risks blowing the (tight, on iOS)
// origin storage quota and triggering eviction.
const RESUME_BYTE_CAP = 250 * 1024 * 1024;

// Per-chunk (and single-PUT) network retry policy.
const MAX_PUT_ATTEMPTS = 5;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with jitter.
function backoffDelay(attempt: number): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

type PutErrorKind = "http" | "network" | "abort";
class PutError extends Error {
  kind: PutErrorKind;
  status?: number;
  constructor(kind: PutErrorKind, status?: number) {
    super(`PUT ${kind}${status ? ` ${status}` : ""}`);
    this.name = "PutError";
    this.kind = kind;
    this.status = status;
  }
}

function isTransientStatus(status?: number): boolean {
  return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

/** One XHR PUT of a blob to a presigned URL. Registers itself so it can be
 * aborted on pause/cancel. Rejects with a typed {@link PutError}. */
function putBlobXHR(
  url: string,
  body: Blob,
  contentType: string,
  opts: {
    onProgress?: (loaded: number) => void;
    xhrSet: Set<XMLHttpRequest>;
  },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    opts.xhrSet.add(xhr);
    const done = () => opts.xhrSet.delete(xhr);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded);
    });
    xhr.addEventListener("load", () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new PutError("http", xhr.status));
    });
    xhr.addEventListener("error", () => {
      done();
      reject(new PutError("network"));
    });
    xhr.addEventListener("abort", () => {
      done();
      reject(new PutError("abort"));
    });
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(body);
  });
}

/** PUT with pause-awareness, backoff retry, and lazy URL refresh on expiry. */
async function putWithRetry(
  body: Blob,
  contentType: string,
  h: {
    getUrl: () => string;
    onProgress?: (loaded: number) => void;
    xhrSet: Set<XMLHttpRequest>;
    isCancelled: () => boolean;
    isPaused: () => boolean;
    waitWhilePaused: () => Promise<void>;
    refreshUrl?: () => Promise<void>;
  },
): Promise<void> {
  let attempt = 0;
  for (;;) {
    if (h.isCancelled()) throw new PutError("abort");
    await h.waitWhilePaused();
    if (h.isCancelled()) throw new PutError("abort");

    try {
      await putBlobXHR(h.getUrl(), body, contentType, {
        onProgress: h.onProgress,
        xhrSet: h.xhrSet,
      });
      return;
    } catch (err) {
      if (h.isCancelled()) throw err;
      const pe = err instanceof PutError ? err : new PutError("network");

      // Aborted purely because we paused — loop back and wait, no attempt spent.
      if (pe.kind === "abort" && h.isPaused()) continue;

      // Expired presigned URL → refresh once and retry (counts as an attempt).
      if (pe.kind === "http" && pe.status === 403 && h.refreshUrl) {
        await h.refreshUrl().catch(() => {});
      }

      const retryable =
        pe.kind === "network" ||
        pe.kind === "abort" ||
        (pe.kind === "http" && (pe.status === 403 || isTransientStatus(pe.status)));

      attempt++;
      if (!retryable || attempt >= MAX_PUT_ATTEMPTS) throw pe;
      await sleep(backoffDelay(attempt));
    }
  }
}

// Helper to resize media and get base64
const THUMB_TIMEOUT_MS = 8_000;
const THUMB_MAX_SIZE = 320;
const VIDEO_FRAME_TIMEOUT_MS = 350;

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

const VIDEO_EXTENSIONS = new Set([
  "3gp",
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
]);

const fileExtension = (file: File): string =>
  file.name.split(".").pop()?.toLowerCase() ?? "";

const isImageFile = (file: File): boolean =>
  file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(fileExtension(file));

const isVideoFile = (file: File): boolean =>
  file.type.startsWith("video/") || VIDEO_EXTENSIONS.has(fileExtension(file));

type ThumbnailResult = { thumbnail: string; aspectRatio: number };

const generateThumbnail = (
  file: File,
): Promise<ThumbnailResult | undefined> => {
  const work = new Promise<
    { thumbnail: string; aspectRatio: number } | undefined
  >((resolve) => {
    // Handle images (existing logic)
    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const aspectRatio = img.width / img.height;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > THUMB_MAX_SIZE) {
              height *= THUMB_MAX_SIZE / width;
              width = THUMB_MAX_SIZE;
            }
          } else {
            if (height > THUMB_MAX_SIZE) {
              width *= THUMB_MAX_SIZE / height;
              height = THUMB_MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, width, height);
            resolve({
              thumbnail: canvas.toDataURL("image/jpeg", 0.8),
              aspectRatio,
            });
          } else {
            resolve(undefined);
          }
        };
        img.onerror = () => resolve(undefined);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
      return;
    }

    // Handle videos
    if (isVideoFile(file)) {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      let settled = false;
      let drawAttempts = 0;

      const finish = (
        result: { thumbnail: string; aspectRatio: number } | undefined,
      ) => {
        if (settled) return;
        settled = true;
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
        resolve(result);
      };

      const drawFrame = () => {
        if (settled) return;
        try {
          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;

          if (!sourceWidth || !sourceHeight || video.readyState < 2) {
            drawAttempts += 1;
            if (drawAttempts < 12) {
              requestAnimationFrame(drawFrame);
            } else {
              finish(undefined);
            }
            return;
          }

          const canvas = document.createElement("canvas");
          let width = sourceWidth;
          let height = sourceHeight;

          if (width > height) {
            if (width > THUMB_MAX_SIZE) {
              height *= THUMB_MAX_SIZE / width;
              width = THUMB_MAX_SIZE;
            }
          } else if (height > THUMB_MAX_SIZE) {
            width *= THUMB_MAX_SIZE / height;
            height = THUMB_MAX_SIZE;
          }

          canvas.width = Math.max(1, Math.round(width));
          canvas.height = Math.max(1, Math.round(height));
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            finish(undefined);
            return;
          }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish({
            thumbnail: canvas.toDataURL("image/jpeg", 0.8),
            aspectRatio: sourceWidth / sourceHeight,
          });
        } catch {
          drawAttempts += 1;
          if (drawAttempts < 12) {
            requestAnimationFrame(drawFrame);
          } else {
            finish(undefined);
          }
        }
      };

      const scheduleDraw = () => {
        if (typeof video.requestVideoFrameCallback === "function") {
          let frameSettled = false;
          const fallbackId = setTimeout(() => {
            if (frameSettled) return;
            frameSettled = true;
            requestAnimationFrame(() => drawFrame());
          }, VIDEO_FRAME_TIMEOUT_MS);

          video.requestVideoFrameCallback(() => {
            if (frameSettled) return;
            frameSettled = true;
            clearTimeout(fallbackId);
            drawFrame();
          });
        } else {
          requestAnimationFrame(() => drawFrame());
        }
      };

      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      video.addEventListener("loadedmetadata", () => {
        // Seek to 10% of duration or 1s, whichever is smaller.
        // iOS can be finicky here, so we fall back to the first decoded frame
        // if seeking never lands.
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const seekTo = duration > 0 ? Math.min(1, duration * 0.1) : 0;
        try {
          video.currentTime = seekTo;
        } catch {
          scheduleDraw();
        }

        setTimeout(() => {
          if (!settled) scheduleDraw();
        }, 1500);
      });

      video.addEventListener("loadeddata", () => {
        scheduleDraw();
      });

      video.addEventListener("canplay", () => {
        scheduleDraw();
      });

      video.addEventListener("seeked", () => {
        scheduleDraw();
      });

      video.addEventListener("error", () => {
        finish(undefined); // Resolve undefined, don't reject — thumbnail is optional
      });

      setTimeout(() => {
        if (!settled) {
          console.warn("[Thumbnail] Video thumbnail timed out, skipping");
          finish(undefined);
        }
      }, THUMB_TIMEOUT_MS);

      video.src = url;
      video.load();

      return;
    }

    resolve(undefined);
  });

  let settled = false;

  return Promise.race([
    work.then((result) => { settled = true; return result; }),
    new Promise<undefined>((resolve) =>
      setTimeout(() => {
        if (settled) return;
        console.warn("[Thumbnail] Timed out, skipping thumbnail");
        resolve(undefined);
      }, THUMB_TIMEOUT_MS),
    ),
  ]);
};

/**
 * Compute chunk size based on file type and size.
 *
 * Streamable media (video/audio):
 *   - Chunks stay small so the first frame loads quickly via MediaSource.
 *   - < 100 MB  →  2 MB   (50 chunks max, instant start)
 *   - 100 MB–1 GB  →  4 MB   (balanced: ~250 chunks for 1 GB)
 *   - > 1 GB  →  8 MB   (still ~2-4 s first-chunk on 10 Mbps)
 *
 * Other files (archives, documents, etc.):
 *   - Optimize for upload throughput — fewer HTTP round-trips.
 *   - max(8 MB, fileSize / 100) capped at 64 MB
 */
function getAdaptiveChunkSize(fileSize: number, mimeType: string): number {
  const isStreamable =
    mimeType.startsWith("video/") || mimeType.startsWith("audio/");

  if (isStreamable) {
    if (fileSize < 100 * 1024 * 1024) return 2 * 1024 * 1024; // 2 MB
    if (fileSize < 1024 * 1024 * 1024) return 4 * 1024 * 1024; // 4 MB
    return 8 * 1024 * 1024; // 8 MB
  }
  // Non-streamable: bigger chunks, fewer requests
  const adaptive = Math.max(8 * 1024 * 1024, Math.floor(fileSize / 100));
  return Math.min(adaptive, 64 * 1024 * 1024);
}

function getMediaCategory(mimeType: string): string {
  if (!mimeType) return "other";
  mimeType = mimeType.toLowerCase();
  
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  
  if (mimeType.includes("pdf")) return "pdf";
  
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("xls") || mimeType.includes("csv")) return "excel";
  if (mimeType.includes("wordprocessing") || mimeType.includes("word") || mimeType.includes("doc")) return "word";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint") || mimeType.includes("ppt")) return "powerpoint";
  
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("rar") || mimeType.includes("7z") || mimeType.includes("archive")) return "archive";
  
  if (mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("html") || mimeType.includes("xml") || mimeType.includes("text/css") || mimeType.includes("text/x-") || mimeType.includes("application/x-sh")) return "code";

  if (mimeType.includes("document") || mimeType.includes("text/")) return "document";
  
  return "other";
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [activeUploads, setActiveUploads] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const uploadingIds = useRef(new Set<string>());
  // All in-flight XHRs, grouped by task, so pause/cancel can abort every
  // request a task owns (both the single-PUT and chunked paths register here).
  const xhrsByTask = useRef<Map<string, Set<XMLHttpRequest>>>(new Map());

  // ── Pause controller ────────────────────────────────────────────────────────
  // `pausedRef` is the synchronous source of truth read by upload loops;
  // `isPaused` mirrors it for the UI. Loops park on a promise that resolves when
  // resumed. Cancelled tasks are tracked so an abort can be told apart from a
  // pause-abort (re-queued) or a real failure.
  const pausedRef = useRef(false);
  const resumeWaitersRef = useRef<Array<() => void>>([]);
  const cancelledIds = useRef(new Set<string>());

  const waitWhilePaused = useCallback((): Promise<void> => {
    if (!pausedRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => resumeWaitersRef.current.push(resolve));
  }, []);

  const xhrSetFor = useCallback((taskId: string): Set<XMLHttpRequest> => {
    let set = xhrsByTask.current.get(taskId);
    if (!set) {
      set = new Set();
      xhrsByTask.current.set(taskId, set);
    }
    return set;
  }, []);

  const abortTaskXhrs = useCallback((taskId: string) => {
    const set = xhrsByTask.current.get(taskId);
    if (!set) return;
    for (const xhr of set) {
      try {
        xhr.abort();
      } catch {
        /* noop */
      }
    }
  }, []);

  const pauseAll = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    setIsPaused(true);
    // Abort every in-flight request; the retry loops re-queue on pause-abort.
    for (const taskId of xhrsByTask.current.keys()) abortTaskXhrs(taskId);
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "uploading" ? { ...t, status: "paused" } : t,
      ),
    );
  }, [abortTaskXhrs]);

  const resumeAll = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    setIsPaused(false);
    const waiters = resumeWaitersRef.current;
    resumeWaitersRef.current = [];
    waiters.forEach((w) => w());
    setTasks((prev) =>
      prev.map((t) => (t.status === "paused" ? { ...t, status: "uploading" } : t)),
    );
  }, []);

  const { publicKey: cryptoPublicKey, metadataKey: cryptoMetadataKey } =
    useCrypto();
  // Keep a ref so the useCallback below always reads the latest key
  // without needing to be re-created (avoids stale closure)
  const cryptoPublicKeyRef = useRef<CryptoKey | null>(null);
  cryptoPublicKeyRef.current = cryptoPublicKey;
  const cryptoMetadataKeyRef = useRef<CryptoKey | null>(null);
  cryptoMetadataKeyRef.current = cryptoMetadataKey;

  const uploadEncryptedThumbnail = useCallback(
    async (
      encryptedDataUrl: string,
      bucketId: string,
      fileStorageKey: string,
    ): Promise<string | undefined> => {
      try {
        const thumbKey = `${fileStorageKey}-thumb`;

        // Convert encrypted string to bytes for upload
        const bytes = new TextEncoder().encode(encryptedDataUrl);
        const blob = new Blob([bytes], { type: "application/octet-stream" });

        const presign = await fetch("/api/objects/presign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: `${fileStorageKey.split("/").pop()}-thumb`,
            fileSize: blob.size,
            fileType: "application/octet-stream",
            bucketId,
            prefix: fileStorageKey.includes("/")
              ? fileStorageKey.substring(0, fileStorageKey.lastIndexOf("/") + 1)
              : `users/${sessionRef.current?.user?.id}/`,
            // Attach this thumbnail to the parent file's cleanup session so it
            // is protected by the parent's completion (and reclaimed with it if
            // the upload is abandoned). Without this the thumbnail spawns its
            // own session that never flips to `completed`, and cleanup-orphans
            // deletes the live thumbnail ~24h later.
            sessionFileId: fileStorageKey,
          }),
        });
        const { uploadUrl } = await presign.json();

        await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
        });

        return thumbKey;
      } catch (err) {
        console.error("Failed to upload thumbnail to B2:", err);
        return undefined;
      }
    },
    [],
  );

  /**
   * Determine whether we should encrypt this upload.
   * Requires BOTH:
   *  1. Vault is unlocked (publicKey in memory), AND
   *  2. User has opted in via User Model preference (session.user.encryptByDefault)
   */
  function shouldEncryptNow(): boolean {
    if (!cryptoPublicKeyRef.current) return false;
    // @ts-expect-error additionalFields
    return sessionRef.current?.user?.encryptByDefault || false;
  }

  // Prevent page reload/close during active uploads
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasActiveUploads = tasks.some(
        (t) => t.status === "uploading" || t.status === "pending",
      );

      if (hasActiveUploads) {
        e.preventDefault();
        e.returnValue = ""; // Chrome requires returnValue to be set
        return "You have uploads in progress. Are you sure you want to leave?";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [tasks]);

  // Pause uploads when the tab is backgrounded / device locked / network drops,
  // and resume when it returns. On iOS, locking the phone suspends Safari (it
  // does NOT reload the page), so the in-memory queue survives — we just need to
  // stop firing requests that would fail and re-launch them on wake.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") pauseAll();
      else resumeAll();
    };
    const onOffline = () => pauseAll();
    const onOnline = () => {
      // Only auto-resume if the tab is actually foregrounded.
      if (document.visibilityState !== "hidden") resumeAll();
    };
    const onPageHide = () => pauseAll();
    const onPageShow = () => {
      if (navigator.onLine && document.visibilityState !== "hidden") resumeAll();
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    // Reflect the current state on mount (e.g. loaded while offline).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      pauseAll();
    }

    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pauseAll, resumeAll]);

  const uploadChunkedMediaDirectly = useCallback(
    async (task: UploadTask) => {
      uploadingIds.current.add(task.id);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
        ),
      );

      try {
        let uploadFile = task.file;
        let thumbResultPromise: Promise<ThumbnailResult | undefined> | undefined;

        if (isVideoFile(task.file)) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, statusText: "Generating preview…" } : t,
            ),
          );
          thumbResultPromise = generateThumbnail(task.file).catch(
            () => undefined,
          );
        }

        // Step 1: Optimize video for streaming (Faststart)
        if (isVideoFile(task.file)) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    status: "uploading",
                    progress: 0,
                    statusText: "Optimizing video for streaming…",
                  }
                : t,
            ),
          );
          const optResult = await optimizeVideoForStreaming(task.file);
          uploadFile = optResult.file;
          console.log(`[Upload] ✅ Faststart step done (${task.file.name}, same file: ${uploadFile === task.file})`);
        }

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, statusText: "Generating preview…" } : t,
          ),
        );
        let thumbResult = thumbResultPromise
          ? await thumbResultPromise
          : await generateThumbnail(uploadFile).catch(() => undefined);
        if (!thumbResult?.thumbnail && uploadFile !== task.file && isVideoFile(uploadFile)) {
          console.warn(
            `[Upload] Thumbnail generation failed for original video, retrying optimized video (${task.file.name})`,
          );
          thumbResult = await generateThumbnail(uploadFile).catch(
            () => undefined,
          );
        }
        const rawThumbnail = thumbResult?.thumbnail;
        const aspectRatio = thumbResult?.aspectRatio;
        console.log(`[Upload] ✅ Thumbnail step done (${task.file.name}, generated: ${!!rawThumbnail}, aspectRatio: ${aspectRatio ?? "n/a"})`);
        let thumbnail: string | undefined;
        if (
          rawThumbnail &&
          cryptoMetadataKeyRef.current &&
          shouldEncryptNow()
        ) {
          thumbnail = await encryptThumbnail(
            rawThumbnail,
            cryptoMetadataKeyRef.current,
          ).catch(() => undefined);
        } else {
          thumbnail = rawThumbnail;
        }

        const chunkSize = getAdaptiveChunkSize(
          uploadFile.size,
          uploadFile.type,
        );
        let cipherChunkSize = chunkSize;
        let uploadBody: File | Blob = uploadFile;
        let uploadContentType = uploadFile.type || "application/octet-stream";
        let encryptedDEK: string | undefined;
        let encryptedName: string | undefined;
        let chunkCount = Math.ceil(uploadFile.size / chunkSize);
        let chunkIvs: string | undefined;

        let encryptedMetadata: string | undefined;
        let metadata: FileMetadata | null = null;

        if (shouldEncryptNow()) {
          try {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, statusText: "Reading file info…" } : t,
              ),
            );
            // Extract all metadata sources
            metadata = await extractMetadata(uploadFile, {
              thumbnail: rawThumbnail,
              aspectRatio,
              chunkSize,
              chunkCount,
              chunkIvs: JSON.parse(chunkIvs || "[]"),
            });

            console.log(`[Upload] ✅ Metadata extracted (${task.file.name}):`, metadata);

            /*
            // Handle Subtitle Extraction & Sidecar Upload
            if (metadata.subtitleTracks && metadata.subtitleTracks.length > 0) {
              const updatedSubtitles = [];
              for (const track of metadata.subtitleTracks) {
                try {
                  const vttBlob = await extractSubtitleToVTT(uploadFile, track.id);
                  if (vttBlob) {
                    const sidecarFile = new File([vttBlob], `${uploadFile.name}-${track.language || track.id}.vtt`, { type: "text/vtt" });
                    
                    const sidecarEnc = await encryptFileChunked(
                      sidecarFile,
                      cryptoPublicKeyRef.current!,
                      1 * 1024 * 1024 // 1MB chunks for text
                    );

                    // Presign & Upload sidecar
                    const sidecarId = crypto.randomUUID();
                    const pre = await fetch("/api/objects/presign-upload-multipart", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fileName: sidecarId,
                        fileSize: sidecarEnc.ciphertext.size,
                        fileType: "application/octet-stream",
                        bucketId: task.bucketId,
                        prefix: task.prefix,
                        chunkCount: sidecarEnc.chunkCount,
                        chunkSize: sidecarEnc.chunkSize,
                      }),
                    });

                    if (pre.ok) {
                      const { fileId, urls, bucketId: stBucketData } = await pre.json();
                      const sidecarChunkUploads = [];
                      for (let i = 0; i < urls.length; i++) {
                        const start = i * sidecarEnc.chunkSize;
                        const end = Math.min(start + sidecarEnc.chunkSize, sidecarEnc.ciphertext.size);
                        const cBlob = sidecarEnc.ciphertext.slice(start, end);
                        await fetch(urls[i].url, { method: "PUT", body: cBlob });
                        sidecarChunkUploads.push({ index: i, key: urls[i].key, size: cBlob.size });
                      }
                      
                      const comp = await fetch("/api/objects/complete-upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          objectKey: fileId,
                          bucketId: stBucketData,
                          size: sidecarEnc.ciphertext.size,
                          contentType: "application/octet-stream",
                          originalContentType: "text/vtt",
                          mediaCategory: "document",
                          isEncrypted: true,
                          encryptedDEK: sidecarEnc.encryptedDEK,
                          encryptedName: await encryptMetadataString("subtitle.vtt", cryptoMetadataKeyRef.current!),
                          chunkSize: sidecarEnc.chunkSize,
                          chunkCount: sidecarEnc.chunkCount,
                          chunkIvs: JSON.stringify(sidecarEnc.chunkIvs),
                          isChunked: true,
                          chunks: sidecarChunkUploads,
                          // Optional: mark it hidden or sidecar so it doesn't show randomly in dashboard
                          isSidecar: true, 
                        }),
                      });

                      if (comp.ok) {
                        const result = await comp.json();
                        updatedSubtitles.push({ ...track, objectId: result.object._id });
                      } else {
                        updatedSubtitles.push(track);
                      }
                    } else {
                      updatedSubtitles.push(track);
                    }
                  } else {
                    updatedSubtitles.push(track);
                  }
                } catch (e) {
                  console.warn(`[E2EE] Failed to process subtitle track ${track.id}`, e);
                  updatedSubtitles.push(track);
                }
              }
              metadata.subtitleTracks = updatedSubtitles;
            }

            // Handle Audio Track Extraction & Sidecar Upload
            // Only extract extra tracks (index 1+). Track 0 stays native in the video.
            if (metadata.audioTracks && metadata.audioTracks.length > 1) {
              const updatedAudioTracks = [metadata.audioTracks[0]]; // keep track 0 as-is (native)

              for (let i = 1; i < metadata.audioTracks.length; i++) {
                const track = metadata.audioTracks[i];
                try {
                  const audioBlob = await extractAudioTrack(uploadFile, i, track.language || `track${i}`);

                  if (audioBlob) {
                    const sidecarFile = new File(
                      [audioBlob],
                      `${uploadFile.name}-audio-${track.language || i}.m4a`,
                      { type: "audio/mp4" },
                    );

                    const sidecarEnc = await encryptFileChunked(
                      sidecarFile,
                      cryptoPublicKeyRef.current!,
                      2 * 1024 * 1024, // 2MB chunks
                    );

                    const sidecarId = crypto.randomUUID();
                    const pre = await fetch("/api/objects/presign-upload-multipart", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fileName: sidecarId,
                        fileSize: sidecarEnc.ciphertext.size,
                        fileType: "application/octet-stream",
                        bucketId: task.bucketId,
                        prefix: task.prefix,
                        chunkCount: sidecarEnc.chunkCount,
                        chunkSize: sidecarEnc.chunkSize,
                      }),
                    });

                    if (pre.ok) {
                      const { fileId, urls, bucketId: stBucketData } = await pre.json();
                      const audioChunkUploads = [];

                      for (let ci = 0; ci < urls.length; ci++) {
                        const start = ci * sidecarEnc.chunkSize;
                        const end = Math.min(start + sidecarEnc.chunkSize, sidecarEnc.ciphertext.size);
                        const cBlob = sidecarEnc.ciphertext.slice(start, end);
                        await fetch(urls[ci].url, { method: "PUT", body: cBlob });
                        audioChunkUploads.push({ index: ci, key: urls[ci].key, size: cBlob.size });
                      }

                      const comp = await fetch("/api/objects/complete-upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          objectKey: fileId,
                          bucketId: stBucketData,
                          size: sidecarEnc.ciphertext.size,
                          contentType: "application/octet-stream",
                          originalContentType: "audio/aac",
                          mediaCategory: "audio",
                          isEncrypted: true,
                          encryptedDEK: sidecarEnc.encryptedDEK,
                          encryptedName: await encryptMetadataString(
                            `${track.language || `track${i}`}.aac`,
                            cryptoMetadataKeyRef.current!,
                          ),
                          chunkSize: sidecarEnc.chunkSize,
                          chunkCount: sidecarEnc.chunkCount,
                          chunkIvs: JSON.stringify(sidecarEnc.chunkIvs),
                          isChunked: true,
                          chunks: audioChunkUploads,
                          isSidecar: true,
                          // parentObjectId will be patched after main upload completes
                        }),
                      });

                      if (comp.ok) {
                        const result = await comp.json();
                        updatedAudioTracks.push({ ...track, objectId: result.object._id });
                      } else {
                        updatedAudioTracks.push(track);
                      }
                    } else {
                      updatedAudioTracks.push(track);
                    }
                  } else {
                    updatedAudioTracks.push(track);
                  }
                } catch (e) {
                  console.warn(`[E2EE] Failed to extract audio track ${i}`, e);
                  updatedAudioTracks.push(track);
                }
              }

              metadata.audioTracks = updatedAudioTracks;
            }
            */

            // Encrypt standardized metadata object
            encryptedMetadata = await encryptMetadataObject(
              metadata,
              cryptoMetadataKeyRef.current!,
            );

            // Legacy backward-compatibility headers (optional but kept for safety)
            encryptedName = await encryptMetadataString(
              uploadFile.name,
              cryptoMetadataKeyRef.current!,
            );

            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, statusText: "Encrypting file…" } : t,
              ),
            );

            const enc = await encryptFileChunked(
              uploadFile,
              cryptoPublicKeyRef.current!,
              chunkSize,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            chunkCount = enc.chunkCount;
            chunkIvs = JSON.stringify(enc.chunkIvs);
            cipherChunkSize = chunkSize + 16;
          } catch (err) {
            failClosedOnEncryptionError(err);
          }
        }

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, statusText: "Uploading…" } : t,
          ),
        );

        // Stable presign filename — reused if we have to re-presign (URL expiry
        // during a long pause) so the same B2 chunk keys are hit.
        const presignFileName = shouldEncryptNow()
          ? crypto.randomUUID()
          : task.file.name;

        const presignMultipart = async () => {
          const res = await fetch("/api/objects/presign-upload-multipart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: presignFileName,
              fileSize: uploadBody.size,
              fileType: uploadContentType,
              bucketId: task.bucketId,
              prefix: task.prefix,
              chunkCount,
              chunkSize,
            }),
          });
          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || "Failed to get multipart upload URLs");
          }
          return res.json();
        };

        let presign = await presignMultipart();
        const fileId: string = presign.fileId;
        let urls: { index: number; key: string; url: string }[] = presign.urls;
        const returnedBucketId: string = presign.bucketId;
        const serverChunkSize: number = presign.chunkSize;
        const sessionId: string | undefined = presign.sessionId;

        // Handle thumbnail upload to B2
        let thumbnailKey: string | undefined;
        if (thumbnail && thumbnail.startsWith("enc:")) {
          thumbnailKey = await uploadEncryptedThumbnail(
            thumbnail,
            returnedBucketId,
            fileId,
          );
        }

        const totalSize = uploadBody.size;
        const userId = sessionRef.current?.user?.id;
        const encryptedContentTypeVal =
          shouldEncryptNow() && cryptoMetadataKeyRef.current
            ? await encryptMetadataString(
                uploadFile.type,
                cryptoMetadataKeyRef.current,
              )
            : undefined;

        // Deterministic per-chunk metadata (ciphertext slice sizes) — matches
        // what we PUT and is resume-safe (independent of upload order).
        const allChunks = Array.from({ length: chunkCount }, (_, i) => {
          const start = i * cipherChunkSize;
          const end = Math.min(start + cipherChunkSize, totalSize);
          return { index: i, key: urls[i].key, size: end - start };
        });

        // Journal the upload so a reload can resume it (bytes only under the cap).
        if (userId) {
          await saveUploadRecord(userId, {
            id: task.id,
            userId,
            status: "uploading",
            createdAt: Date.now(),
            fileName: task.file.name,
            size: task.file.size,
            type: uploadFile.type,
            mediaCategory: getMediaCategory(uploadFile.type),
            bucketId: returnedBucketId,
            prefix: task.prefix,
            aspectRatio,
            isChunked: true,
            isEncrypted: !!encryptedDEK,
            fileId,
            sessionId,
            uploadContentType,
            encryptedDEK,
            chunkSize: serverChunkSize,
            cipherChunkSize,
            chunkCount,
            chunkIvs,
            completedChunks: [],
            encryptedName,
            encryptedContentType: encryptedContentTypeVal,
            encryptedMetadata,
            thumbnail: thumbnailKey || thumbnail,
            thumbnailKey,
            bytesPersisted: totalSize <= RESUME_BYTE_CAP,
            mainBytes: totalSize <= RESUME_BYTE_CAP ? uploadBody : undefined,
          }).catch(() => {});
        }

        // Completed indices live in this closure, so they survive pause/resume
        // (the worker parks rather than restarting). Fresh live upload → empty.
        const completed = new Set<number>();
        const loaded = new Array(chunkCount).fill(0);
        for (const i of completed) {
          const start = i * cipherChunkSize;
          loaded[i] = Math.min(cipherChunkSize, totalSize - start);
        }
        const xhrSet = xhrSetFor(task.id);
        const updateProgress = () => {
          const totalLoaded = loaded.reduce((a, b) => a + b, 0);
          const progress = Math.round((totalLoaded / totalSize) * 100);
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, progress } : t)),
          );
        };
        const refreshUrls = async () => {
          presign = await presignMultipart();
          urls = presign.urls;
        };

        let nextIndex = 0;
        const uploadWorker = async () => {
          while (true) {
            const i = nextIndex++;
            if (i >= chunkCount) break;
            if (completed.has(i)) continue;
            const start = i * cipherChunkSize;
            const end = Math.min(start + cipherChunkSize, totalSize);
            const chunkBlob = uploadBody.slice(start, end);

            await putWithRetry(chunkBlob as Blob, uploadContentType, {
              getUrl: () => urls[i].url,
              onProgress: (l) => {
                loaded[i] = l;
                updateProgress();
              },
              xhrSet,
              isCancelled: () => cancelledIds.current.has(task.id),
              isPaused: () => pausedRef.current,
              waitWhilePaused,
              refreshUrl: refreshUrls,
            });

            loaded[i] = chunkBlob.size;
            completed.add(i);
            if (userId) markChunkComplete(userId, task.id, i).catch(() => {});
            updateProgress();
          }
        };

        const workers = Array.from(
          { length: Math.min(4, chunkCount) },
          () => uploadWorker(),
        );
        await Promise.all(workers);

        const completeResponse = await fetch("/api/objects/complete-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectKey: fileId,
            bucketId: returnedBucketId,
            size: totalSize,
            contentType: uploadFile.type || "application/octet-stream",
            originalContentType: uploadFile.type,
            mediaCategory: getMediaCategory(uploadFile.type),
            encryptedContentType: encryptedContentTypeVal,
            thumbnail: thumbnailKey || thumbnail, // Use thumbnailKey if available, otherwise original thumbnail
            isEncrypted: !!encryptedDEK,
            encryptedDEK,
            encryptedName,
            chunkSize: serverChunkSize,
            chunkCount,
            chunkIvs,
            isChunked: true,
            chunks: allChunks,
            encryptedMetadata,
            aspectRatio,
          }),
        });

        if (!completeResponse.ok) {
          const error = await completeResponse.json();
          throw new Error(error.error || "Failed to save file metadata");
        }

        const completeData = await completeResponse.json();
        await upsertLocalObject(
          sessionRef.current?.user?.id,
          completeData.object,
          returnedBucketId,
        );
        if (userId) await deleteUploadRecord(userId, task.id).catch(() => {});

        /*
        // Patch sidecar objects (audio and subtitles) with parentObjectId now that we have the main object's ID
        if (mainObjectId && metadata) {
          const tracks = [
            ...(metadata.audioTracks || []),
            ...(metadata.subtitleTracks || [])
          ];
          
          for (const track of tracks) {
            if ((track as any).objectId) {
              await fetch(`/api/objects/complete-upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  objectKey: (track as any).objectId, // pass the sidecar's ID as key to look it up
                  parentObjectId: mainObjectId,
                  // minimal fields — API will do a find-and-update via objectKey matching
                }),
              }).catch(() => {});
            }
          }
        }
        */

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: "completed", progress: 100, statusText: undefined } : t,
          ),
        );
      } catch (error) {
        const cancelled = cancelledIds.current.has(task.id);
        if (cancelled) {
          const uid = sessionRef.current?.user?.id;
          if (uid) await deleteUploadRecord(uid, task.id).catch(() => {});
        } else {
          console.error("Upload error:", error);
        }
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: "failed",
                  statusText: undefined,
                  error: cancelled
                    ? "Upload cancelled"
                    : error instanceof Error
                      ? error.message
                      : "Upload failed",
                }
              : t,
          ),
        );
      } finally {
        uploadingIds.current.delete(task.id);
        xhrsByTask.current.delete(task.id);
        cancelledIds.current.delete(task.id);
        setActiveUploads((prev) => prev - 1);
      }
    },
    [uploadEncryptedThumbnail, waitWhilePaused, xhrSetFor],
  );

  const uploadFileDirectly = useCallback(async (task: UploadTask) => {
    // Prevent double upload (React Strict Mode)
    if (uploadingIds.current.has(task.id)) {
      return;
    }

    if (
      task.file.type.startsWith("video/") ||
      task.file.type.startsWith("audio/")
    ) {
      uploadChunkedMediaDirectly(task);
      return;
    }

    uploadingIds.current.add(task.id);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
      ),
    );

    try {
      const thumbResult = await generateThumbnail(task.file).catch(
        () => undefined,
      );
      const rawThumbnail = thumbResult?.thumbnail;
      const aspectRatioFromThumb = thumbResult?.aspectRatio;

      let thumbnail: string | undefined;
      if (rawThumbnail && cryptoMetadataKeyRef.current && shouldEncryptNow()) {
        thumbnail = await encryptThumbnail(
          rawThumbnail,
          cryptoMetadataKeyRef.current,
        ).catch(() => undefined);
      } else {
        thumbnail = rawThumbnail;
      }

      // Step 1: Get presigned URL from server. Stable filename so a re-presign
      // (URL expiry during a long pause) reuses the same B2 key.
      const mainFileName = shouldEncryptNow()
        ? crypto.randomUUID()
        : task.file.name;
      const presignMain = async () => {
        const res = await fetch("/api/objects/presign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: mainFileName,
            fileSize: task.file.size,
            fileType: shouldEncryptNow()
              ? "application/octet-stream"
              : task.file.type,
            bucketId: task.bucketId,
            prefix: task.prefix,
          }),
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error.error || "Failed to get upload URL");
        }
        return res.json();
      };

      const mainPresign = await presignMain();
      const objectKey: string = mainPresign.objectKey;
      const returnedBucketId: string = mainPresign.bucketId;
      let uploadUrl: string = mainPresign.uploadUrl;
      const mainSessionId: string | undefined = mainPresign.sessionId;

      // Step 2: Generate preview for images
      let optimizedFile: File | null = null;
      let optimizedObjectKey: string | undefined;
      let optimizedUploadUrl: string | undefined;
      let aspectRatio = aspectRatioFromThumb;

      if (
        task.file.type.startsWith("image/") ||
        [
          "heic",
          "heif",
          "cr2",
          "cr3",
          "nef",
          "nrw",
          "arw",
          "srf",
          "dng",
          "raf",
          "rw2",
          "orf",
          "pef",
        ].includes(task.file.name.split(".").pop()?.toLowerCase() ?? "")
      ) {
        try {
          const { preview, original, aspectRatio: previewAR } = await generatePreview(
            task.file,
          );
          if (previewAR) aspectRatio = previewAR;

          if (preview !== original && preview.size < task.file.size) {
            optimizedFile = preview;

            const optPresignRes = await fetch("/api/objects/presign-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileName: shouldEncryptNow()
                  ? crypto.randomUUID()
                  : optimizedFile.name,
                fileSize: optimizedFile.size,
                fileType: shouldEncryptNow()
                  ? "application/octet-stream"
                  : optimizedFile.type,
                bucketId: task.bucketId,
                prefix: task.prefix,
                // Attach this blob to the main upload's cleanup session.
                sessionFileId: objectKey,
              }),
            });

            if (optPresignRes.ok) {
              const optData = await optPresignRes.json();
              optimizedObjectKey = optData.objectKey;
              optimizedUploadUrl = optData.uploadUrl;
            }
          }
        } catch (err) {
          console.warn(
            "[Preview] Generation failed, skipping optimized version",
            err,
          );
        }
      }

      // Step 3: Encrypt file if vault is unlocked, otherwise upload plaintext
      let uploadBody: File | Blob = task.file;
      let uploadContentType = task.file.type || "application/octet-stream";
      let encryptedDEK: string | undefined;
      let encryptedIV: string | undefined;
      let encryptedName: string | undefined;
      // Chunked encryption fields (video/audio only)
      let chunkSize: number | undefined;
      let chunkCount: number | undefined;
      let chunkIvs: string | undefined; // JSON string

      let encryptedMetadata: string | undefined;

      if (shouldEncryptNow()) {
        try {
          const isStreamable =
            task.file.type.startsWith("video/") ||
            task.file.type.startsWith("audio/");

          // Common Metadata Extraction
          const metadata = await extractMetadata(task.file, {
            thumbnail: rawThumbnail,
          });

          if (isStreamable) {
            const enc = await encryptFileChunked(
              task.file,
              cryptoPublicKeyRef.current!,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            chunkSize = enc.chunkSize;
            chunkCount = enc.chunkCount;
            chunkIvs = JSON.stringify(enc.chunkIvs);

            // Update metadata with chunk info
            metadata.chunkSize = chunkSize;
            metadata.chunkCount = chunkCount;
            metadata.chunkIvs = enc.chunkIvs;
          } else {
            const enc = await encryptFile(
              task.file,
              cryptoPublicKeyRef.current!,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            encryptedIV = enc.iv;
          }

          // Encrypt standardized metadata object
          encryptedMetadata = await encryptMetadataObject(
            {
              ...metadata,
              aspectRatio,
            },
            cryptoMetadataKeyRef.current!,
          );

          // Legacy fields for backward compatibility
          encryptedName = await encryptMetadataString(
            task.file.name,
            cryptoMetadataKeyRef.current!,
          );
        } catch (err) {
          failClosedOnEncryptionError(err);
        }
      }

      // Step 4: Handle thumbnail upload to B2
      let thumbnailKey: string | undefined;
      if (thumbnail && thumbnail.startsWith("enc:")) {
        thumbnailKey = await uploadEncryptedThumbnail(
          thumbnail,
          returnedBucketId,
          objectKey,
        );
      }

      // Step 5: Encrypt the optimized version (if any) so we can journal + PUT it.
      let optimizedIV: string | undefined;
      let optimizedSize: number | undefined;
      let optimizedEncryptedDEK: string | undefined;
      let optBody: Blob | undefined;

      if (optimizedFile && optimizedUploadUrl && optimizedObjectKey) {
        optBody = optimizedFile;
        optimizedSize = optimizedFile.size;
        if (shouldEncryptNow()) {
          const enc = await encryptFile(
            optimizedFile,
            cryptoPublicKeyRef.current!,
          );
          optBody = enc.ciphertext;
          optimizedIV = enc.iv;
          optimizedEncryptedDEK = enc.encryptedDEK;
        }
      }

      const userId = sessionRef.current?.user?.id;
      const mainSize =
        uploadBody instanceof Blob ? uploadBody.size : task.file.size;
      const withinCap = mainSize <= RESUME_BYTE_CAP;
      const encryptedContentTypeVal =
        shouldEncryptNow() && cryptoMetadataKeyRef.current
          ? await encryptMetadataString(
              task.file.type,
              cryptoMetadataKeyRef.current,
            )
          : undefined;
      const optContentType = shouldEncryptNow()
        ? "application/octet-stream"
        : optimizedFile?.type || "application/octet-stream";

      // Journal for reload-resume (persist bytes only under the cap).
      if (userId) {
        await saveUploadRecord(userId, {
          id: task.id,
          userId,
          status: "uploading",
          createdAt: Date.now(),
          fileName: task.file.name,
          size: task.file.size,
          type: task.file.type,
          mediaCategory: getMediaCategory(task.file.type),
          bucketId: returnedBucketId,
          prefix: task.prefix,
          aspectRatio,
          isChunked: false,
          isEncrypted: !!encryptedDEK,
          fileId: objectKey,
          sessionId: mainSessionId,
          uploadContentType,
          encryptedDEK,
          iv: encryptedIV,
          completedChunks: [],
          encryptedName,
          encryptedContentType: encryptedContentTypeVal,
          encryptedMetadata,
          thumbnail: thumbnailKey || thumbnail,
          thumbnailKey,
          optimizedKey: optimizedObjectKey,
          optimizedIV,
          optimizedEncryptedDEK,
          optimizedSize,
          optimizedContentType: optimizedFile?.type,
          bytesPersisted: withinCap,
          mainBytes: withinCap ? (uploadBody as Blob) : undefined,
          optimizedBytes: withinCap ? optBody : undefined,
        }).catch(() => {});
      }

      const xhrSet = xhrSetFor(task.id);
      const isCancelled = () => cancelledIds.current.has(task.id);
      const isPausedNow = () => pausedRef.current;

      // Step 5b: Upload optimized version (best-effort — a failure here must not
      // kill the main upload; we just drop the preview reference).
      if (optBody && optimizedUploadUrl && optimizedObjectKey) {
        try {
          await putWithRetry(optBody, optContentType, {
            getUrl: () => optimizedUploadUrl!,
            xhrSet,
            isCancelled,
            isPaused: isPausedNow,
            waitWhilePaused,
          });
        } catch (e) {
          if (isCancelled()) throw e;
          console.warn("[Upload] optimized upload failed, continuing without it", e);
          optimizedObjectKey = undefined;
          optimizedIV = undefined;
          optimizedEncryptedDEK = undefined;
          optimizedSize = undefined;
        }
      }

      // Step 6: Upload the main file (retryable, pause-aware, progress-tracked).
      await putWithRetry(uploadBody as Blob, uploadContentType, {
        getUrl: () => uploadUrl,
        onProgress: (loaded) => {
          const progress = Math.round((loaded / mainSize) * 100);
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, progress } : t)),
          );
        },
        xhrSet,
        isCancelled,
        isPaused: isPausedNow,
        waitWhilePaused,
        refreshUrl: async () => {
          const p = await presignMain();
          uploadUrl = p.uploadUrl;
        },
      });

      // Step 4: Notify server of completion
      const completeResponse = await fetch("/api/objects/complete-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey,
          bucketId: returnedBucketId,
          size: uploadBody instanceof Blob ? uploadBody.size : task.file.size,
          contentType: shouldEncryptNow()
            ? "application/octet-stream"
            : task.file.type,
          originalContentType: task.file.type,
          mediaCategory: getMediaCategory(task.file.type),
          encryptedContentType: encryptedContentTypeVal,
          thumbnail: thumbnailKey || thumbnail, // Use thumbnailKey if available, otherwise original thumbnail
          isEncrypted: !!encryptedDEK,
          encryptedDEK,
          iv: encryptedIV,
          encryptedName,
          chunkSize,
          chunkCount,
          chunkIvs,
          encryptedMetadata,
          optimizedKey: optimizedObjectKey,
          optimizedSize,
          optimizedContentType: optimizedFile?.type,
          optimizedIV,
          optimizedEncryptedDEK,
          aspectRatio,
        }),
      });

      if (!completeResponse.ok) {
        const error = await completeResponse.json();
        throw new Error(error.error || "Failed to save file metadata");
      }

      const completeData = await completeResponse.json();
      await upsertLocalObject(
        sessionRef.current?.user?.id,
        completeData.object,
        returnedBucketId,
      );
      if (userId) await deleteUploadRecord(userId, task.id).catch(() => {});

      // Mark as completed
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "completed", progress: 100 } : t,
        ),
      );
    } catch (error) {
      const wasCancelled = cancelledIds.current.has(task.id);
      if (wasCancelled) {
        const uid = sessionRef.current?.user?.id;
        if (uid) await deleteUploadRecord(uid, task.id).catch(() => {});
      } else {
        console.error("Upload error:", error);
      }
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: "failed",
                error: wasCancelled
                  ? "Upload cancelled"
                  : error instanceof Error
                    ? error.message
                    : "Upload failed",
              }
            : t,
        ),
      );
    } finally {
      uploadingIds.current.delete(task.id);
      xhrsByTask.current.delete(task.id);
      cancelledIds.current.delete(task.id);
      setActiveUploads((prev) => prev - 1);
    }
  }, [
    uploadChunkedMediaDirectly,
    uploadEncryptedThumbnail,
    waitWhilePaused,
    xhrSetFor,
  ]);

  // Records eligible for auto-resume after a reload, kept so retryTask can
  // re-drive them. Populated by the rehydrate effect below.
  const resumeRecordsRef = useRef<Map<string, UploadRecord>>(new Map());
  const rehydratedRef = useRef(false);

  /**
   * Resume an upload from its persisted, encrypted bytes after a reload. Skips
   * pieces already in B2 (via /api/objects/upload-status), re-PUTs the rest to
   * the SAME keys, then finalizes. Works for both the chunked and single paths.
   */
  const resumeRecord = useCallback(
    async (rec: UploadRecord) => {
      const userId = rec.userId || sessionRef.current?.user?.id;
      if (!userId) return;
      if (uploadingIds.current.has(rec.id)) return;
      uploadingIds.current.add(rec.id);

      const xhrSet = xhrSetFor(rec.id);
      const isCancelled = () => cancelledIds.current.has(rec.id);
      const isPausedNow = () => pausedRef.current;
      const setTask = (patch: Partial<UploadTask>) =>
        setTasks((prev) =>
          prev.map((t) => (t.id === rec.id ? { ...t, ...patch } : t)),
        );
      const fileNameFor = (key: string) =>
        key.startsWith(rec.prefix)
          ? key.slice(rec.prefix.length)
          : (key.split("/").pop() ?? key);

      setTask({
        status: pausedRef.current ? "paused" : "uploading",
        statusText: "Resuming…",
        interrupted: false,
        error: undefined,
      });

      try {
        if (!rec.mainBytes) throw new Error("Upload bytes unavailable");

        // What's already in B2?
        let mainExists = false;
        const serverDone = new Set<number>(rec.completedChunks ?? []);
        try {
          const st = await fetch(
            `/api/objects/upload-status?bucketId=${encodeURIComponent(
              rec.bucketId,
            )}&fileId=${encodeURIComponent(rec.fileId)}`,
          );
          if (st.ok) {
            const j = await st.json();
            mainExists = !!j.mainExists;
            if (Array.isArray(j.completedChunks))
              for (const i of j.completedChunks) serverDone.add(i);
          }
        } catch {
          /* fall back to the persisted completedChunks */
        }

        if (rec.isChunked) {
          const cipherChunkSize = rec.cipherChunkSize ?? 0;
          const chunkCount = rec.chunkCount ?? 0;
          if (!cipherChunkSize || !chunkCount)
            throw new Error("Missing chunk metadata");
          const total = rec.mainBytes.size;
          const presignBody = {
            fileName: fileNameFor(rec.fileId),
            fileSize: total,
            fileType: rec.uploadContentType,
            bucketId: rec.bucketId,
            prefix: rec.prefix,
            chunkCount,
            chunkSize: rec.chunkSize,
          };
          const presignMultipart = async () => {
            const res = await fetch("/api/objects/presign-upload-multipart", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(presignBody),
            });
            if (!res.ok) throw new Error("Failed to re-presign chunks");
            return res.json();
          };
          let presign = await presignMultipart();
          let urls = presign.urls as { index: number; key: string; url: string }[];

          const loaded = new Array(chunkCount).fill(0);
          for (const i of serverDone)
            loaded[i] = Math.min(cipherChunkSize, total - i * cipherChunkSize);
          const update = () => {
            const tl = loaded.reduce((a, b) => a + b, 0);
            setTask({ progress: Math.round((tl / total) * 100), statusText: undefined });
          };
          update();

          let next = 0;
          const worker = async () => {
            while (true) {
              const i = next++;
              if (i >= chunkCount) break;
              if (serverDone.has(i)) continue;
              const start = i * cipherChunkSize;
              const end = Math.min(start + cipherChunkSize, total);
              const blob = rec.mainBytes!.slice(start, end);
              await putWithRetry(blob, rec.uploadContentType, {
                getUrl: () => urls[i].url,
                onProgress: (l) => {
                  loaded[i] = l;
                  update();
                },
                xhrSet,
                isCancelled,
                isPaused: isPausedNow,
                waitWhilePaused,
                refreshUrl: async () => {
                  presign = await presignMultipart();
                  urls = presign.urls;
                },
              });
              loaded[i] = blob.size;
              serverDone.add(i);
              markChunkComplete(userId, rec.id, i).catch(() => {});
              update();
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(4, chunkCount) }, () => worker()),
          );

          const allChunks = Array.from({ length: chunkCount }, (_, i) => {
            const start = i * cipherChunkSize;
            const end = Math.min(start + cipherChunkSize, total);
            return { index: i, key: urls[i].key, size: end - start };
          });
          let thumbKey = rec.thumbnailKey;
          if (!thumbKey && rec.thumbnail?.startsWith("enc:"))
            thumbKey = await uploadEncryptedThumbnail(
              rec.thumbnail,
              rec.bucketId,
              rec.fileId,
            );

          const comp = await fetch("/api/objects/complete-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objectKey: rec.fileId,
              bucketId: rec.bucketId,
              size: total,
              contentType: rec.type || "application/octet-stream",
              originalContentType: rec.type,
              mediaCategory: rec.mediaCategory,
              encryptedContentType: rec.encryptedContentType,
              thumbnail: thumbKey || rec.thumbnail,
              isEncrypted: rec.isEncrypted,
              encryptedDEK: rec.encryptedDEK,
              encryptedName: rec.encryptedName,
              chunkSize: rec.chunkSize,
              chunkCount,
              chunkIvs: rec.chunkIvs,
              isChunked: true,
              chunks: allChunks,
              encryptedMetadata: rec.encryptedMetadata,
              aspectRatio: rec.aspectRatio,
            }),
          });
          if (!comp.ok) {
            const e = await comp.json().catch(() => ({}));
            throw new Error(e.error || "Failed to finalize upload");
          }
          const cd = await comp.json();
          await upsertLocalObject(userId, cd.object, rec.bucketId);
        } else {
          const total = rec.mainBytes.size;
          // Optimized preview (best-effort).
          if (rec.optimizedBytes && rec.optimizedKey) {
            try {
              const op = await (
                await fetch("/api/objects/presign-upload", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    fileName: fileNameFor(rec.optimizedKey),
                    fileSize: rec.optimizedBytes.size,
                    fileType: rec.isEncrypted
                      ? "application/octet-stream"
                      : rec.optimizedContentType,
                    bucketId: rec.bucketId,
                    prefix: rec.prefix,
                    sessionFileId: rec.fileId,
                  }),
                })
              ).json();
              await putWithRetry(
                rec.optimizedBytes,
                rec.isEncrypted
                  ? "application/octet-stream"
                  : rec.optimizedContentType || "application/octet-stream",
                {
                  getUrl: () => op.uploadUrl,
                  xhrSet,
                  isCancelled,
                  isPaused: isPausedNow,
                  waitWhilePaused,
                },
              );
            } catch (e) {
              if (isCancelled()) throw e;
              console.warn("[Resume] optimized upload failed, skipping", e);
            }
          }
          if (!mainExists) {
            const p = await (
              await fetch("/api/objects/presign-upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  fileName: fileNameFor(rec.fileId),
                  fileSize: total,
                  fileType: rec.uploadContentType,
                  bucketId: rec.bucketId,
                  prefix: rec.prefix,
                }),
              })
            ).json();
            await putWithRetry(rec.mainBytes, rec.uploadContentType, {
              getUrl: () => p.uploadUrl,
              onProgress: (l) =>
                setTask({ progress: Math.round((l / total) * 100), statusText: undefined }),
              xhrSet,
              isCancelled,
              isPaused: isPausedNow,
              waitWhilePaused,
            });
          }
          let thumbKey = rec.thumbnailKey;
          if (!thumbKey && rec.thumbnail?.startsWith("enc:"))
            thumbKey = await uploadEncryptedThumbnail(
              rec.thumbnail,
              rec.bucketId,
              rec.fileId,
            );
          const comp = await fetch("/api/objects/complete-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objectKey: rec.fileId,
              bucketId: rec.bucketId,
              size: total,
              contentType: rec.isEncrypted
                ? "application/octet-stream"
                : rec.type,
              originalContentType: rec.type,
              mediaCategory: rec.mediaCategory,
              encryptedContentType: rec.encryptedContentType,
              thumbnail: thumbKey || rec.thumbnail,
              isEncrypted: rec.isEncrypted,
              encryptedDEK: rec.encryptedDEK,
              iv: rec.iv,
              encryptedName: rec.encryptedName,
              encryptedMetadata: rec.encryptedMetadata,
              optimizedKey: rec.optimizedKey,
              optimizedSize: rec.optimizedSize,
              optimizedContentType: rec.optimizedContentType,
              optimizedIV: rec.optimizedIV,
              optimizedEncryptedDEK: rec.optimizedEncryptedDEK,
              aspectRatio: rec.aspectRatio,
            }),
          });
          if (!comp.ok) {
            const e = await comp.json().catch(() => ({}));
            throw new Error(e.error || "Failed to finalize upload");
          }
          const cd = await comp.json();
          await upsertLocalObject(userId, cd.object, rec.bucketId);
        }

        await deleteUploadRecord(userId, rec.id).catch(() => {});
        resumeRecordsRef.current.delete(rec.id);
        setTask({ status: "completed", progress: 100, statusText: undefined });
      } catch (error) {
        const cancelled = isCancelled();
        if (cancelled) {
          await deleteUploadRecord(userId, rec.id).catch(() => {});
          resumeRecordsRef.current.delete(rec.id);
        } else {
          console.error("[Resume] error:", error);
        }
        setTask({
          status: "failed",
          statusText: undefined,
          error: cancelled
            ? "Upload cancelled"
            : error instanceof Error
              ? error.message
              : "Resume failed",
        });
      } finally {
        uploadingIds.current.delete(rec.id);
        xhrsByTask.current.delete(rec.id);
        cancelledIds.current.delete(rec.id);
      }
    },
    [waitWhilePaused, xhrSetFor, uploadEncryptedThumbnail],
  );

  const processQueue = useCallback(() => {
    setTasks((currentTasks) => {
      const pending = currentTasks.filter((t) => t.status === "pending");
      const canStart = MAX_CONCURRENT_UPLOADS - activeUploads;

      if (canStart > 0 && pending.length > 0) {
        const toStart = pending.slice(0, canStart);
        toStart.forEach((task) => {
          setActiveUploads((prev) => prev + 1);
          uploadFileDirectly(task);
        });
      }

      return currentTasks;
    });
  }, [activeUploads, uploadFileDirectly]);

  const addTasks = useCallback(
    (files: File[], bucketId: string, prefix: string) => {
      const newTasks: UploadTask[] = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        bucketId,
        prefix,
        status: "pending",
        progress: 0,
      }));

      // Best-effort: keep our IndexedDB from being evicted mid-upload (iOS).
      void requestPersistentStorage();

      setTasks((prev) => [...prev, ...newTasks]);

      // Process queue after state update
      setTimeout(processQueue, 0);
    },
    [processQueue],
  );

  const removeTask = useCallback((id: string) => {
    resumeRecordsRef.current.delete(id);
    const uid = sessionRef.current?.user?.id;
    if (uid) deleteUploadRecord(uid, id).catch(() => {});
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const cancelTask = useCallback(
    (id: string) => {
      cancelledIds.current.add(id);
      abortTaskXhrs(id);
      resumeRecordsRef.current.delete(id);
      const uid = sessionRef.current?.user?.id;
      if (uid) deleteUploadRecord(uid, id).catch(() => {});
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: "failed", error: "Upload cancelled" }
            : t,
        ),
      );
    },
    [abortTaskXhrs],
  );

  const retryTask = useCallback(
    (id: string) => {
      cancelledIds.current.delete(id);
      const rec = resumeRecordsRef.current.get(id);
      if (rec) {
        void resumeRecord(rec);
        return;
      }
      // Live task whose File is still in memory — re-queue from scratch.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id && t.status === "failed" && !t.interrupted
            ? { ...t, status: "pending", progress: 0, error: undefined }
            : t,
        ),
      );
      setTimeout(processQueue, 0);
    },
    [resumeRecord, processQueue],
  );

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== "completed"));
  }, []);

  // Rehydrate interrupted uploads after a reload. Records with persisted bytes
  // auto-resume; bytes-less records (over the resume cap) surface as a failed,
  // "interrupted" task and their B2 orphans are reclaimed by the cleanup cron.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || rehydratedRef.current) return;
    rehydratedRef.current = true;
    (async () => {
      const records = await listUploadRecords(userId).catch(() => []);
      if (!records.length) return;
      const resumable = records.filter((r) => r.bytesPersisted && r.mainBytes);
      const stale = records.filter((r) => !r.bytesPersisted || !r.mainBytes);

      setTasks((prev) => {
        const existing = new Set(prev.map((t) => t.id));
        const add: UploadTask[] = [];
        for (const r of resumable) {
          if (existing.has(r.id)) continue;
          add.push({
            id: r.id,
            file: new File([], r.fileName, { type: r.type }),
            bucketId: r.bucketId,
            prefix: r.prefix,
            status: "paused",
            progress: 0,
            statusText: "Waiting to resume…",
          });
        }
        for (const r of stale) {
          if (existing.has(r.id)) continue;
          add.push({
            id: r.id,
            file: new File([], r.fileName, { type: r.type }),
            bucketId: r.bucketId,
            prefix: r.prefix,
            status: "failed",
            progress: 0,
            interrupted: true,
            error:
              "Upload interrupted — too large to resume automatically. Please re-upload.",
          });
        }
        return add.length ? [...prev, ...add] : prev;
      });

      for (const r of resumable) resumeRecordsRef.current.set(r.id, r);
      // Bytes-less records can't be resumed client-side; drop them (the cron
      // cleans their B2 blobs via the still-pending UploadSession).
      for (const r of stale) deleteUploadRecord(userId, r.id).catch(() => {});
      // Auto-resume. resumeRecord parks itself while paused (offline/hidden).
      for (const r of resumable) void resumeRecord(r);
    })();
  }, [session?.user?.id, resumeRecord]);

  // Auto-process queue when active uploads decrease
  React.useEffect(() => {
    if (activeUploads < MAX_CONCURRENT_UPLOADS) {
      processQueue();
    }
  }, [activeUploads, processQueue]);

  return (
    <UploadContext.Provider
      value={{
        tasks,
        isPaused,
        addTasks,
        removeTask,
        cancelTask,
        clearCompleted,
        pauseAll,
        resumeAll,
        retryTask,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within UploadProvider");
  }
  return context;
}
