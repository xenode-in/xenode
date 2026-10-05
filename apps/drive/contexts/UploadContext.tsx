"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  UploadEngine,
  acceptAllUploadPolicy,
  createMemoryCheckpointStore,
  WRITE_ONCE_PUT_HEADERS,
  resumeUploadRecord,
  validateUploadReservation,
  createScopedUploadRequest,
  RESUME_BYTE_CAP,
  NonRetryableUploadError,
  type UploadRecord,
  type UploadJournalScope,
} from "@xenode/upload-engine";
import { useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  encryptFileBlob,
  encryptFileParts,
  encryptMetadataString,
  encryptMetadataObject,
  encryptThumbnail,
  type FileKeyTarget,
} from "@/lib/crypto/fileEncryption";
import { fileChunkCount, fileCiphertextBytes } from "@xenode/crypto-core";
import { failClosedOnEncryptionError } from "@/lib/crypto/encryptionPolicy";
import type { FileMetadata } from "@/lib/metadata/types";
import { extractFileMetadata } from "@/lib/metadata/metadataClient";
import { optimizeVideoForStreaming } from "@/lib/video/faststart";
import { upsertLocalObject } from "@/lib/db/object-cache";
import { useWorkspace, driveScopeSpaceId } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";
import {
  saveUploadRecord,
  markChunkComplete,
  listSealedUploadRecords,
  getUploadRecord,
  deleteUploadRecord,
  requestPersistentStorage,
  type UploadJournalContext,
} from "@/lib/uploads/persistence";

export interface UploadTask {
  id: string;
  scope: UploadJournalScope;
  file: File;
  bucketId: string;
  /** Destination folder record id (null = Space root); never part of the key. */
  folderId: string | null;
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
  addTasks: (files: File[], bucketId: string, folderId: string | null) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  clearCompleted: () => void;
  pauseAll: () => void;
  resumeAll: () => void;
  retryTask: (id: string) => void;
}

interface UploadSnapshot {
  scope: UploadJournalScope;
  metadataKey: CryptoKey;
  target: FileKeyTarget;
  currentVersion: number | null;
  journal: UploadJournalContext;
  isActive(): boolean;
  checkActive(): void;
  abort(): void;
  dispose(): void;
  signal: AbortSignal;
  waitWhilePaused(): Promise<void>;
  request(path: string, init?: RequestInit): Promise<Response>;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const MAX_CONCURRENT_UPLOADS = 5;

// Persist encrypted bytes for resume-after-reload only up to this size. Larger
// files stay resumable while the tab is open (pause/resume) but are not written
// to IndexedDB — storing e.g. a 1 GB video risks blowing the (tight, on iOS)
// origin storage quota and triggering eviction.

// Per-chunk (and single-PUT) network retry policy.
const MAX_PUT_ATTEMPTS = 5;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isIOSBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

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
    xhr.setRequestHeader("If-None-Match", WRITE_ONCE_PUT_HEADERS["If-None-Match"]);
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

      // Every non-cancel abort comes from our pause controller. The page may
      // already have resumed before this handler runs, so never spend a retry
      // attempt for an internally aborted request.
      if (pe.kind === "abort") {
        await h.waitWhilePaused();
        continue;
      }

      // Expired presigned URL → refresh once and retry (counts as an attempt).
      if (pe.kind === "http" && pe.status === 403 && h.refreshUrl) {
        await h.refreshUrl().catch(() => {});
      }

      const retryable =
        pe.kind === "network" ||
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
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const taskEpochsRef = useRef(new Map<string, object>());
  const engineRef = useRef<UploadEngine | null>(null);
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

  const waitWhilePaused = useCallback((signal?: AbortSignal): Promise<void> => {
    if (!pausedRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        resumeWaitersRef.current = resumeWaitersRef.current.filter((waiter) => waiter !== done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      if (signal?.aborted) { done(); return; }
      resumeWaitersRef.current.push(done);
      signal?.addEventListener("abort", done, { once: true });
    });
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

  // Stop scheduling new requests without aborting requests already in flight.
  // iOS may suspend background JavaScript/networking; allowing current PUTs to
  // finish avoids corrupting their retry state while later chunks wait safely.
  const parkAll = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    engineRef.current?.pause();
    setIsPaused(true);
    setTasks((prev) =>
      prev.map((task) =>
        task.status === "uploading" ? { ...task, status: "paused" } : task,
      ),
    );
  }, []);

  const pauseAll = useCallback(() => {
    parkAll();
    // Abort every in-flight request; the retry loops re-queue on pause-abort.
    for (const taskId of xhrsByTask.current.keys()) abortTaskXhrs(taskId);
  }, [abortTaskXhrs, parkAll]);

  const resumeAll = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    engineRef.current?.resume();
    setIsPaused(false);
    const waiters = resumeWaitersRef.current;
    resumeWaitersRef.current = [];
    waiters.forEach((w) => w());
    setTasks((prev) =>
      prev.map((t) => (t.status === "paused" ? { ...t, status: "uploading" } : t)),
    );
  }, []);

  const cryptoContext = useCrypto();
  const workspace = useWorkspace();
  const { current: workspaceKey, isWorkspaceEncrypted, keyFor, reload: reloadWorkspaceKeyring } = useWorkspaceSpaceKey();
  const reloadWorkspaceKeyringRef = useRef(reloadWorkspaceKeyring);
  reloadWorkspaceKeyringRef.current = reloadWorkspaceKeyring;
  const keyForRef = useRef(keyFor);
  keyForRef.current = keyFor;
  const accountId = session?.user?.id ?? "";
  const spaceId = accountId ? driveScopeSpaceId(workspace.driveScope, accountId) : "";
  const access = useMemo(() => ({
    accountId, spaceId, unlocked: cryptoContext.isUnlocked,
    wrappedBy: isWorkspaceEncrypted ? "space" as const : "user" as const,
    version: isWorkspaceEncrypted ? workspaceKey?.keyVersion ?? null : null,
    publicKey: cryptoContext.publicKey,
    metadataKey: isWorkspaceEncrypted ? workspaceKey?.metadataKey ?? null : cryptoContext.metadataKey,
    journalKey: isWorkspaceEncrypted ? workspaceKey?.uploadJournalKey ?? null : cryptoContext.uploadJournalKey,
    rawKey: isWorkspaceEncrypted ? workspaceKey?.rawKey ?? null : null,
  }), [accountId, spaceId, cryptoContext.isUnlocked, cryptoContext.publicKey, cryptoContext.metadataKey,
    cryptoContext.uploadJournalKey, isWorkspaceEncrypted, workspaceKey]);
  const accessRef = useRef(access);
  accessRef.current = access;
  const snapshotsRef = useRef(new Map<string, UploadSnapshot>());
  const resumeRecordsRef = useRef(new Map<string, UploadRecord>());

  const captureUploadContext = useCallback((task: Pick<UploadTask, "id" | "scope">,
    journalKey?: CryptoKey): UploadSnapshot => {
    const current = accessRef.current;
    if (!current.unlocked || !current.metadataKey || !current.journalKey ||
      task.scope.accountId !== current.accountId || task.scope.spaceId !== current.spaceId ||
      task.scope.wrappedBy !== current.wrappedBy || task.scope.productId !== "drive") throw new Error("Unlock this workspace to resume uploads");
    if (!journalKey && task.scope.spaceKeyVersion !== current.version) throw new Error("Workspace keys changed; retry this upload");
    if (current.wrappedBy === "space" && (!current.rawKey || !current.version)) throw new Error("Workspace keys are unavailable");
    if (current.wrappedBy === "user" && !current.publicKey) throw new Error("Vault keys are unavailable");
    const controller = new AbortController();
    const isActive = () => accessRef.current === current && !controller.signal.aborted;
    const checkActive = () => { if (!isActive()) throw new Error("Upload encryption context changed"); };
    const target: FileKeyTarget = current.wrappedBy === "space"
      ? { wrappedBy: "space", rawSpaceKey: current.rawKey!.slice(), spaceId: current.spaceId, spaceKeyVersion: current.version! }
      : { wrappedBy: "user", publicKey: current.publicKey! };
    const snapshot: UploadSnapshot = {
      scope: task.scope, metadataKey: current.metadataKey, target, currentVersion: current.version,
      signal: controller.signal, waitWhilePaused: () => waitWhilePaused(controller.signal),
      isActive, checkActive, abort: () => controller.abort(),
      journal: { scope: task.scope, key: journalKey ?? current.journalKey, isActive },
      request: createScopedUploadRequest({ scope: task.scope, signal: controller.signal, isActive,
        waitWhilePaused: () => waitWhilePaused(controller.signal) }),
      dispose() {
        controller.abort();
        abortTaskXhrs(task.id);
        if (target.wrappedBy === "space") target.rawSpaceKey.fill(0);
        if (snapshotsRef.current.get(task.id) === snapshot) snapshotsRef.current.delete(task.id);
      },
    };
    snapshotsRef.current.set(task.id, snapshot);
    return snapshot;
  }, [abortTaskXhrs, waitWhilePaused]);

  // A lock, account/Space change or key rotation invalidates every outstanding job.
  // Cleanup aborts work; render filters prevent stale filenames from being shown.
  useEffect(() => () => {
    for (const [id, epoch] of taskEpochsRef.current) {
      if (epoch !== access) continue;
      engineRef.current?.cancel(id);
      abortTaskXhrs(id);
      taskEpochsRef.current.delete(id);
    }
    for (const [id, snapshot] of snapshotsRef.current) {
      snapshot.abort();
      engineRef.current?.cancel(id);
      abortTaskXhrs(id);
      snapshot.dispose();
    }
    resumeRecordsRef.current.clear();
    const waiters = resumeWaitersRef.current;
    resumeWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, [access, abortTaskXhrs]);
  const uploadEncryptedThumbnail = useCallback(
    async (
      encryptedDataUrl: string,
      bucketId: string,
      fileStorageKey: string,
      parentSessionId: string,
      context: UploadSnapshot,
    ): Promise<string | undefined> => {
      try {
        // Convert encrypted string to bytes for upload
        const bytes = new TextEncoder().encode(encryptedDataUrl);
        const blob = new Blob([bytes], { type: "application/octet-stream" });

        const presign = await context.request("/api/objects/presign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileSize: blob.size,
            fileType: "application/octet-stream",
            bucketId,
            // The parent reservation determines this thumbnail's B2 key and
            // keeps it protected through completion or orphan cleanup.
            parentSessionId,
            variant: "thumbnail",
          }),
        });
        if (!presign.ok) throw new Error("Thumbnail upload reservation expired");
        const { uploadUrl, objectKey } = await presign.json();
        context.checkActive();
        if (objectKey !== `${fileStorageKey}-thumb`) throw new Error("Thumbnail reservation identity changed");

        const uploaded = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", ...WRITE_ONCE_PUT_HEADERS },
          credentials: "omit",
          signal: context.signal,
          body: blob,
        });
        if (!uploaded.ok) throw new Error(`Thumbnail upload failed (${uploaded.status})`);
        context.checkActive();

        return objectKey;
      } catch (err) {
        console.error("Failed to upload thumbnail to B2:", err);
        return undefined;
      }
    },
    [],
  );

  async function sealUploadMetadata(
    fileId: string,
    file: File,
    metadata: FileMetadata | null,
    rawThumbnail: string | undefined,
    metadataKey: CryptoKey,
  ) {
    if (!metadataKey || !metadata) throw new Error("Metadata key unavailable");
    return {
      thumbnail: rawThumbnail
        ? await encryptThumbnail(rawThumbnail, metadataKey, fileId).catch(() => undefined)
        : undefined,
      encryptedMetadata: await encryptMetadataObject(metadata, metadataKey, fileId),
      encryptedName: await encryptMetadataString(file.name, metadataKey, { fileId, purpose: "name" }),
      encryptedContentType: await encryptMetadataString(file.type, metadataKey, {
        fileId,
        purpose: "content-type",
      }),
    };
  }

  function spaceFieldsFor(target: FileKeyTarget) {
    return target.wrappedBy === "space"
      ? { wrappedBy: "space", spaceKeyVersion: target.spaceKeyVersion }
      : {};
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

  // Pause only for a real connectivity loss or page navigation/BFCache. Normal
  // tab switches keep active PUT requests alive. On iOS only, park new chunks
  // while hidden because Safari may suspend the page; never abort active PUTs.
  useEffect(() => {
    const ios = isIOSBrowser();
    const onVisibilityChange = () => {
      if (!ios) return;
      if (document.visibilityState === "hidden") {
        parkAll();
      } else if (navigator.onLine) {
        resumeAll();
      }
    };
    const onOffline = () => pauseAll();
    const onOnline = () => resumeAll();
    const onPageHide = () => pauseAll();
    const onPageShow = () => {
      if (navigator.onLine) resumeAll();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    // Reflect the current state on mount (e.g. loaded while offline).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      pauseAll();
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [parkAll, pauseAll, resumeAll]);

  const uploadChunkedMediaDirectly = useCallback(
    async (task: UploadTask) => {
      uploadingIds.current.add(task.id);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
        ),
      );

      let context: UploadSnapshot | undefined;
      try {
        context = captureUploadContext(task);
        let uploadFile = task.file;
        let rawThumbnail: string | undefined;
        let aspectRatio: number | undefined;
        let thumbnail: string | undefined;

        // Relocate the MP4 `moov` atom to the front (pure-JS box rewrite, no
        // transcode) so the encrypted video streams from its first chunks
        // instead of forcing a full download. Fail-safe: returns the original
        // file for non-MP4, fragmented, already-faststart, or malformed input.
        if (isVideoFile(uploadFile)) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? { ...t, statusText: "Optimizing video for streaming…" }
                : t,
            ),
          );
          const opt = await optimizeVideoForStreaming(uploadFile).catch(
            () => null,
          );
          if (opt?.file) uploadFile = opt.file;
        }

        const chunkSize = getAdaptiveChunkSize(
          uploadFile.size,
          uploadFile.type,
        );
        // Sealed sizes are known before encryption, so the upload is reserved
        // first and every chunk is bound to the reservation's object id.
        const cipherChunkSize = chunkSize + 16;
        const chunkCount = fileChunkCount(uploadFile.size, chunkSize);
        const totalSize = fileCiphertextBytes(uploadFile.size, chunkSize);
        const uploadContentType = "application/octet-stream";
        let encryptedDEK: string | undefined;
        let spaceKeyWrapIv: string | undefined;
        let encryptedName: string | undefined;
        let encryptedContentTypeVal: string | undefined;
        let chunkIvs: string | undefined;

        let encryptedMetadata: string | undefined;
        let metadata: FileMetadata | null = null;

        context.checkActive(); {
          try {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, statusText: "Reading file info…" } : t,
              ),
            );
            // Extract metadata + preview off the main thread (hardened worker).
            const extracted = await extractFileMetadata(uploadFile);
            metadata = extracted.metadata;
            rawThumbnail = extracted.rawThumbnail;
            aspectRatio = extracted.aspectRatio;
            metadata.thumbnail = rawThumbnail ?? null;

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
                        const uploaded = await fetch(urls[i].url, { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...WRITE_ONCE_PUT_HEADERS }, credentials: "omit", body: cBlob });
                        if (!uploaded.ok) throw new Error(`Sidecar upload failed (${uploaded.status})`);
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
                        const uploaded = await fetch(urls[ci].url, { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...WRITE_ONCE_PUT_HEADERS }, credentials: "omit", body: cBlob });
                        if (!uploaded.ok) throw new Error(`Audio sidecar upload failed (${uploaded.status})`);
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

          } catch (err) {
            failClosedOnEncryptionError(err);
          }
        }

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, statusText: "Uploading…" } : t,
          ),
        );

        let sessionId: string | undefined = undefined;
        const reservedIdentity: { fileId?: string } = {};
        const presignMultipart = async () => {
          const res = await context!.request(
            "/api/objects/presign-upload-multipart",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileSize: totalSize,
                fileType: uploadContentType,
                bucketId: task.bucketId,
                chunkCount,
                chunkSize,
                sessionId,
              }),
            },
          );
          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || "Failed to get multipart upload URLs");
          }
          const data = await res.json();
          context!.checkActive();
          validateUploadReservation(data, { spaceId: task.scope.spaceId, bucketId: task.bucketId,
            sessionId, fileId: reservedIdentity.fileId });
          return data;
        };

        let presign = await presignMultipart();
        const fileId: string = presign.fileId;
        reservedIdentity.fileId = fileId;
        let urls: { index: number; key: string; url: string }[] = presign.urls;
        const returnedBucketId: string = presign.bucketId;
        const serverChunkSize: number = presign.chunkSize;
        sessionId = presign.sessionId;
        if (!sessionId || serverChunkSize !== chunkSize) {
          throw new Error("Upload reservation does not match the encrypted layout");
        }

        const keyTarget = context.target;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, statusText: "Encrypting file…" } : t,
          ),
        );
        let uploadBody: Blob;
        try {
          const enc = await encryptFileParts(uploadFile, sessionId, chunkSize, keyTarget);
          uploadBody = new Blob(enc.parts, { type: uploadContentType });
          encryptedDEK = enc.encryptedDEK;
          spaceKeyWrapIv = enc.spaceKeyWrapIv;
          chunkIvs = JSON.stringify(enc.chunkIvs);
        } catch (err) {
          failClosedOnEncryptionError(err);
        }
        if (uploadBody.size !== totalSize) {
          throw new Error("Encrypted size does not match the reservation");
        }
        try {
          const sealed = await sealUploadMetadata(sessionId, uploadFile, metadata, rawThumbnail, context.metadataKey);
          thumbnail = sealed.thumbnail;
          encryptedMetadata = sealed.encryptedMetadata;
          encryptedName = sealed.encryptedName;
          encryptedContentTypeVal = sealed.encryptedContentType;
        } catch (err) {
          failClosedOnEncryptionError(err);
        }

        // Handle thumbnail upload to B2
        let thumbnailKey: string | undefined;
        if (thumbnail) {
          thumbnailKey = await uploadEncryptedThumbnail(
            thumbnail,
            returnedBucketId,
            fileId,
            sessionId,
            context,
          );
        }

        const userId = context.scope.accountId;

        // Deterministic per-chunk metadata (ciphertext slice sizes) — matches
        // what we PUT and is resume-safe (independent of upload order).
        const allChunks = Array.from({ length: chunkCount }, (_, i) => {
          const start = i * cipherChunkSize;
          const end = Math.min(start + cipherChunkSize, totalSize);
          return { index: i, key: urls[i].key, size: end - start };
        });

        // Journal the upload so a reload can resume it (bytes only under the cap).
        if (userId) {
          await saveUploadRecord(context.journal, {
            id: task.id,
            userId,
            spaceId: context.scope.spaceId,
            wrappedBy: context.scope.wrappedBy,
            spaceKeyVersion: context.scope.spaceKeyVersion ?? undefined,
            spaceKeyWrapIv,
            status: "uploading",
            createdAt: Date.now(),
            fileName: task.file.name,
            size: task.file.size,
            type: uploadFile.type,
            mediaCategory: getMediaCategory(uploadFile.type),
            bucketId: returnedBucketId,
            folderId: task.folderId,
            aspectRatio,
            isChunked: true,
            isEncrypted: true,
            fileId,
            sessionId,
            uploadContentType,
            encryptedDEK: encryptedDEK!,
            chunkSize: serverChunkSize,
            cipherChunkSize,
            chunkCount,
            chunkIvs,
            completedChunks: [],
            encryptedName: encryptedName!,
            encryptedContentType: encryptedContentTypeVal,
            encryptedMetadata,
            thumbnail,
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
              isCancelled: () => cancelledIds.current.has(task.id) || !context!.isActive(),
              waitWhilePaused: context!.waitWhilePaused,
              refreshUrl: refreshUrls,
            });

            loaded[i] = chunkBlob.size;
            completed.add(i);
            if (userId) await markChunkComplete(context!.journal, task.id, i).catch(() => {});
            updateProgress();
          }
        };

        const workers = Array.from(
          { length: Math.min(4, chunkCount) },
          () => uploadWorker(),
        );
        await Promise.all(workers);

        const completeResponse = await context!.request("/api/objects/complete-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectKey: fileId,
            bucketId: returnedBucketId,
            sessionId,
            folderId: task.folderId,
            size: totalSize,
            contentType: uploadFile.type || "application/octet-stream",
            originalContentType: uploadFile.type,
            mediaCategory: getMediaCategory(uploadFile.type),
            encryptedContentType: encryptedContentTypeVal,
            thumbnail: thumbnailKey,
            isEncrypted: true,
            encryptedDEK: encryptedDEK!,
            spaceKeyWrapIv,
            ...spaceFieldsFor(keyTarget),
            encryptedName: encryptedName!,
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
          // A rotation happened since the keyring loaded; a retry uses the new key.
          if (error.code === "stale_space_key_version") {
            await reloadWorkspaceKeyringRef.current().catch(() => undefined);
          }
          throw new Error(error.error || "Failed to save file metadata");
        }

        const completeData = await completeResponse.json();
        await upsertLocalObject(
          context.scope.accountId,
          completeData.object,
          returnedBucketId,
        );
        if (userId) await deleteUploadRecord(context.scope, task.id).catch(() => {});

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
          const uid = context?.scope.accountId;
          if (uid && context) await deleteUploadRecord(context.scope, task.id).catch(() => {});
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
        context?.dispose();
        uploadingIds.current.delete(task.id);
        xhrsByTask.current.delete(task.id);
        cancelledIds.current.delete(task.id);
      }
    },
    [uploadEncryptedThumbnail, xhrSetFor, captureUploadContext],
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
      await uploadChunkedMediaDirectly(task);
      return;
    }

    uploadingIds.current.add(task.id);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
      ),
    );

    let context: UploadSnapshot | undefined;
    try {
      context = captureUploadContext(task);
      let rawThumbnail: string | undefined;
      let thumbnail: string | undefined;

      // The server creates the opaque key; refreshes use the reservation ID.
      let mainSessionId: string | undefined = undefined;
      const reservedIdentity: { fileId?: string } = {};
      const presignMain = async () => {
        const res = await context!.request("/api/objects/presign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // One sealed chunk: the plaintext plus a 16-byte tag.
            fileSize: fileCiphertextBytes(task.file.size, Math.max(task.file.size, 1)),
            fileType: "application/octet-stream",
            bucketId: task.bucketId,
            sessionId: mainSessionId!,
          }),
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error.error || "Failed to get upload URL");
        }
        const data = await res.json();
        context!.checkActive();
        validateUploadReservation(data, { spaceId: task.scope.spaceId, bucketId: task.bucketId,
          sessionId: mainSessionId, fileId: reservedIdentity.fileId });
        return data;
      };

      const mainPresign = await presignMain();
      const objectKey: string = mainPresign.objectKey;
      reservedIdentity.fileId = objectKey;
      const returnedBucketId: string = mainPresign.bucketId;
      let uploadUrl: string = mainPresign.uploadUrl;
      mainSessionId = mainPresign.sessionId;
      if (!mainSessionId) throw new Error("Upload reservation is missing");
      const keyTarget = context.target;

      let aspectRatio: number | undefined;

      // Step 3: Seal the file as one blob bound to the reserved object id
      let uploadBody: Blob = task.file;
      const uploadContentType = "application/octet-stream";
      let encryptedDEK: string | undefined;
      let encryptedIV: string | undefined;
      let spaceKeyWrapIv: string | undefined;
      let encryptedName: string | undefined;
      let encryptedContentTypeVal: string | undefined;

      let encryptedMetadata: string | undefined;

      context.checkActive(); {
        try {
          // Metadata + preview extraction off the main thread (hardened worker).
          const extracted = await extractFileMetadata(task.file);
          rawThumbnail = extracted.rawThumbnail;
          aspectRatio = extracted.aspectRatio;
          extracted.metadata.thumbnail = rawThumbnail ?? null;

          const enc = await encryptFileBlob(task.file, mainSessionId, keyTarget);
          uploadBody = enc.ciphertext;
          encryptedDEK = enc.encryptedDEK;
          encryptedIV = enc.iv;
          spaceKeyWrapIv = enc.spaceKeyWrapIv;

          const sealed = await sealUploadMetadata(
            mainSessionId,
            task.file,
            { ...extracted.metadata, aspectRatio: aspectRatio ?? null },
            rawThumbnail,
            context.metadataKey,
          );
          thumbnail = sealed.thumbnail;
          encryptedMetadata = sealed.encryptedMetadata;
          encryptedName = sealed.encryptedName;
          encryptedContentTypeVal = sealed.encryptedContentType;
        } catch (err) {
          failClosedOnEncryptionError(err);
        }
      }

      // Step 4: Handle thumbnail upload to B2
      let thumbnailKey: string | undefined;
      if (thumbnail) {
        thumbnailKey = await uploadEncryptedThumbnail(
          thumbnail,
          returnedBucketId,
          objectKey,
          mainSessionId,
          context,
        );
      }

      const userId = context.scope.accountId;
      const mainSize = uploadBody.size;
      const withinCap = mainSize <= RESUME_BYTE_CAP;

      // Journal for reload-resume (persist bytes only under the cap).
      if (userId) {
        await saveUploadRecord(context.journal, {
          id: task.id,
          userId,
          spaceId: context.scope.spaceId,
          wrappedBy: context.scope.wrappedBy,
          spaceKeyVersion: context.scope.spaceKeyVersion ?? undefined,
          spaceKeyWrapIv,
          status: "uploading",
          createdAt: Date.now(),
          fileName: task.file.name,
          size: task.file.size,
          type: task.file.type,
          mediaCategory: getMediaCategory(task.file.type),
          bucketId: returnedBucketId,
          folderId: task.folderId,
          aspectRatio,
          isChunked: false,
          isEncrypted: true,
          fileId: objectKey,
          sessionId: mainSessionId!,
          uploadContentType,
          encryptedDEK: encryptedDEK!,
          iv: encryptedIV,
          completedChunks: [],
          encryptedName: encryptedName!,
          encryptedContentType: encryptedContentTypeVal,
          encryptedMetadata,
          thumbnail,
          thumbnailKey,
          bytesPersisted: withinCap,
          mainBytes: withinCap ? (uploadBody as Blob) : undefined,
        }).catch(() => {});
      }

      const xhrSet = xhrSetFor(task.id);
      const isCancelled = () => cancelledIds.current.has(task.id) || !context!.isActive();

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
        waitWhilePaused: context.waitWhilePaused,
        refreshUrl: async () => {
          const p = await presignMain();
          uploadUrl = p.uploadUrl;
        },
      });

      // Step 4: Notify server of completion
      const completeResponse = await context!.request("/api/objects/complete-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey,
          bucketId: returnedBucketId,
          sessionId: mainSessionId!,
          folderId: task.folderId,
          size: uploadBody.size,
          contentType: uploadContentType,
          originalContentType: task.file.type,
          mediaCategory: getMediaCategory(task.file.type),
          encryptedContentType: encryptedContentTypeVal,
          thumbnail: thumbnailKey,
          isEncrypted: true,
          encryptedDEK: encryptedDEK!,
          iv: encryptedIV,
          spaceKeyWrapIv,
          ...spaceFieldsFor(keyTarget),
          encryptedName: encryptedName!,
          encryptedMetadata,
          aspectRatio,
        }),
      });

      if (!completeResponse.ok) {
        const error = await completeResponse.json();
        // A rotation happened since the keyring loaded; a retry uses the new key.
        if (error.code === "stale_space_key_version") {
          await reloadWorkspaceKeyringRef.current().catch(() => undefined);
        }
        throw new Error(error.error || "Failed to save file metadata");
      }

      const completeData = await completeResponse.json();
      await upsertLocalObject(
        context.scope.accountId,
        completeData.object,
        returnedBucketId,
      );
      if (userId) await deleteUploadRecord(context.scope, task.id).catch(() => {});

      // Mark as completed
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "completed", progress: 100 } : t,
        ),
      );
    } catch (error) {
      const wasCancelled = cancelledIds.current.has(task.id);
      if (wasCancelled) {
        const uid = context?.scope.accountId;
        if (uid && context) await deleteUploadRecord(context.scope, task.id).catch(() => {});
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
      context?.dispose();
      uploadingIds.current.delete(task.id);
      xhrsByTask.current.delete(task.id);
      cancelledIds.current.delete(task.id);
    }
  }, [
    uploadChunkedMediaDirectly,
    uploadEncryptedThumbnail,
    xhrSetFor,
    captureUploadContext,
  ]);

  const resumeRecord = useCallback(async (record: UploadRecord) => {
    if (uploadingIds.current.has(record.id)) return;
    const current = accessRef.current;
    if (!current.unlocked || current.accountId !== record.userId || current.spaceId !== record.spaceId) return;
    uploadingIds.current.add(record.id);
    let snapshot: UploadSnapshot | undefined;
    const setTask = (patch: Partial<UploadTask>) => setTasks((previous) =>
      previous.map((task) => task.id === record.id ? { ...task, ...patch } : task));
    try {
      const versionKey = record.wrappedBy === "space" ? await keyForRef.current(record.spaceKeyVersion) : null;
      if (accessRef.current !== current) throw new Error("Upload workspace changed");
      const key = record.wrappedBy === "space" ? versionKey?.uploadJournalKey : current.journalKey;
      if (!key) throw new NonRetryableUploadError("Unlock this workspace to resume uploads");
      const scope: UploadJournalScope = { accountId: record.userId, productId: "drive", spaceId: record.spaceId,
        wrappedBy: record.wrappedBy, spaceKeyVersion: record.spaceKeyVersion ?? null };
      snapshot = captureUploadContext({ id: record.id, scope }, key);
      const active = snapshot;
      setTask({ status: pausedRef.current ? "paused" : "uploading", statusText: "Resuming…", error: undefined });
      const object = await resumeUploadRecord(record, scope, {
        request: active.request, checkActive: active.checkActive,
        put: (body, getUrl, refreshUrl, onProgress) => putWithRetry(body, "application/octet-stream", {
          getUrl, refreshUrl, onProgress, xhrSet: xhrSetFor(record.id), waitWhilePaused: active.waitWhilePaused,
          isCancelled: () => cancelledIds.current.has(record.id) || !active.isActive(),
        }),
      }, {
        currentSpaceKeyVersion: active.currentVersion,
        onProgress: (progress) => setTask({ progress, statusText: undefined }),
        onChunkComplete: (index) => markChunkComplete(active.journal, record.id, index).catch(() => {}),
      });
      active.checkActive();
      await upsertLocalObject(scope.accountId, object as Parameters<typeof upsertLocalObject>[1], record.bucketId);
      active.checkActive();
      await deleteUploadRecord(scope, record.id).catch(() => {});
      resumeRecordsRef.current.delete(record.id);
      setTask({ status: "completed", progress: 100, statusText: undefined });
    } catch (error) {
      if (cancelledIds.current.has(record.id)) {
        const scope: UploadJournalScope = { accountId: record.userId, productId: "drive", spaceId: record.spaceId,
          wrappedBy: record.wrappedBy, spaceKeyVersion: record.spaceKeyVersion ?? null };
        await deleteUploadRecord(scope, record.id).catch(() => {});
        resumeRecordsRef.current.delete(record.id);
      }
      setTask({ status: "failed", statusText: undefined, interrupted: error instanceof NonRetryableUploadError,
        error: error instanceof Error ? error.message : "Resume failed" });
    } finally {
      snapshot?.dispose();
      uploadingIds.current.delete(record.id);
      xhrsByTask.current.delete(record.id);
      cancelledIds.current.delete(record.id);
    }
  }, [captureUploadContext, xhrSetFor]);

  useEffect(() => {
    const engine = new UploadEngine({ async upload(input) {
      const record = resumeRecordsRef.current.get(input.id);
      if (record) await resumeRecord(record);
      else await uploadFileDirectly(input.source as UploadTask);
      return input.id;
    } }, acceptAllUploadPolicy, createMemoryCheckpointStore(), { concurrency: MAX_CONCURRENT_UPLOADS, maxAttempts: 1 });
    engineRef.current = engine;
    return () => {
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [uploadFileDirectly, resumeRecord]);

  const enqueueTask = useCallback((task: UploadTask) => {
    const engine = engineRef.current;
    if (!engine) return;
    taskEpochsRef.current.set(task.id, accessRef.current);
    void engine.enqueue({ id: task.id, name: task.file.name, size: task.file.size,
      contentType: task.file.type, source: task }).then((result) => {
      if (result.status === "cancelled") setTasks((previous) => previous.map((candidate) => candidate.id === task.id
        ? { ...candidate, status: "failed", error: "Upload stopped when its encryption context changed" } : candidate));
    });
  }, []);

  const addTasks = useCallback((files: File[], bucketId: string, folderId: string | null) => {
    const current = accessRef.current;
    if (!current.unlocked || !current.journalKey || !current.metadataKey) return;
    const scope: UploadJournalScope = { accountId: current.accountId, productId: "drive", spaceId: current.spaceId,
      wrappedBy: current.wrappedBy, spaceKeyVersion: current.version };
    const newTasks: UploadTask[] = files.map((file) => ({ id: crypto.randomUUID(), scope: { ...scope },
      file, bucketId, folderId, status: "pending", progress: 0 }));
    void requestPersistentStorage();
    setTasks((previous) => [...previous, ...newTasks]);
    newTasks.forEach(enqueueTask);
  }, [enqueueTask]);

  const taskInCurrentScope = useCallback((id: string) => tasksRef.current.find((task) => task.id === id &&
    task.scope.accountId === accessRef.current.accountId && task.scope.spaceId === accessRef.current.spaceId), []);
  const removeTask = useCallback((id: string) => {
    const task = taskInCurrentScope(id);
    if (!task) return;
    snapshotsRef.current.get(id)?.abort();
    engineRef.current?.cancel(id);
    abortTaskXhrs(id);
    resumeRecordsRef.current.delete(id);
    void deleteUploadRecord(task.scope, id).catch(() => {});
    setTasks((previous) => previous.filter((candidate) => candidate.id !== id));
  }, [taskInCurrentScope, abortTaskXhrs]);
  const cancelTask = useCallback((id: string) => {
    const task = taskInCurrentScope(id);
    if (!task) return;
    cancelledIds.current.add(id);
    snapshotsRef.current.get(id)?.abort();
    engineRef.current?.cancel(id);
    abortTaskXhrs(id);
    resumeRecordsRef.current.delete(id);
    void deleteUploadRecord(task.scope, id).catch(() => {});
    setTasks((previous) => previous.map((candidate) => candidate.id === id
      ? { ...candidate, status: "failed", error: "Upload cancelled" } : candidate));
  }, [taskInCurrentScope, abortTaskXhrs]);

  const retryTask = useCallback((id: string) => {
    const task = taskInCurrentScope(id);
    if (!task || task.interrupted) return;
    cancelledIds.current.delete(id);
    if (resumeRecordsRef.current.has(id)) { enqueueTask(task); return; }
    const current = accessRef.current;
    if (!current.unlocked || !current.journalKey || !current.metadataKey) return;
    // A fresh attempt has a fresh job identity; late callbacks cannot replace it.
    void deleteUploadRecord(task.scope, id).catch(() => {}).then(() => {
      if (accessRef.current !== current) return;
      const scope: UploadJournalScope = { accountId: current.accountId, productId: "drive", spaceId: current.spaceId,
        wrappedBy: current.wrappedBy, spaceKeyVersion: current.version };
      const queued: UploadTask = { ...task, id: crypto.randomUUID(), scope, status: "pending", progress: 0, error: undefined };
      setTasks((previous) => previous.map((candidate) => candidate.id === id ? queued : candidate));
      enqueueTask(queued);
    });
  }, [taskInCurrentScope, enqueueTask]);
  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== "completed"));
  }, []);

  // Read only this account/Space's sealed headers; labels appear only after unlock.
  useEffect(() => {
    if (!access.unlocked || !access.journalKey || !access.metadataKey) return;
    let cancelled = false;
    (async () => {
      const rows = await listSealedUploadRecords(access.accountId, access.spaceId).catch(() => []);
      for (const row of rows) {
        if (cancelled || accessRef.current !== access) return;
        let reader: UploadSnapshot | undefined;
        try {
          const version = row.scope.wrappedBy === "space" ? await keyForRef.current(row.scope.spaceKeyVersion) : null;
          const key = row.scope.wrappedBy === "space" ? version?.uploadJournalKey : access.journalKey;
          if (!key || cancelled || accessRef.current !== access || uploadingIds.current.has(row.id)) continue;
          reader = captureUploadContext({ id: row.id, scope: row.scope }, key);
          const record = await getUploadRecord(reader.journal, row.id);
          reader.checkActive();
          if (!record || cancelled) continue;
          const canResume = record.bytesPersisted && Boolean(record.mainBytes);
          const task: UploadTask = { id: record.id, scope: row.scope,
            file: new File([], record.fileName, { type: record.type }), bucketId: record.bucketId,
            folderId: record.folderId, status: canResume ? "paused" : "failed", progress: 0,
            interrupted: !canResume, error: canResume ? undefined : "Upload interrupted; re-upload this file" };
          setTasks((previous) => previous.some((existing) => existing.id === task.id) ? previous : [...previous, task]);
          if (canResume) resumeRecordsRef.current.set(record.id, record);
          else await deleteUploadRecord(row.scope, row.id).catch(() => {});
          reader.dispose();
          reader = undefined;
          if (cancelled || accessRef.current !== access) return;
          if (canResume) enqueueTask(task);
        } catch {
          // Corrupt, foreign or unavailable-key records never authorize networking.
        } finally { reader?.dispose(); }
      }
    })();
    return () => { cancelled = true; };
  }, [access, captureUploadContext, enqueueTask]);

  const visibleTasks = access.unlocked && access.metadataKey && access.journalKey
    ? tasks.filter((task) => task.scope.accountId === access.accountId && task.scope.spaceId === access.spaceId) : [];
  return (
    <UploadContext.Provider
      value={{
        tasks: visibleTasks,
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
