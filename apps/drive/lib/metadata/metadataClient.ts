/**
 * lib/metadata/metadataClient.ts
 *
 * Main-thread client for the hardened metadata worker.
 *
 * Responsibilities:
 *   • Owns a single long-lived {@link Worker} that runs exifr + mediainfo off
 *     the UI thread (see workers/metadata.worker.ts for the security rationale).
 *   • Enforces a hard wall-clock timeout per request; on timeout it TERMINATES
 *     and recreates the worker, so a file that wedges a parser can never hang
 *     uploads — it just degrades to basic metadata (fail-open).
 *   • Generates video thumbnails here on the main thread, because a <video>
 *     element (the only way to grab a frame) is not available inside a worker.
 *     That still uses the browser's native, sandboxed video decoder.
 *
 * Extraction is best-effort enrichment: every failure path yields a valid
 * FileMetadata built from the File's own attributes, and the upload proceeds.
 */

import type { FileMetadata } from "./types";
import { inspectFileHeader } from "@/lib/file-security/inspection";
import type { ImageMetrics } from "@/lib/file-security/types";

type MediaCategory = FileMetadata["mediaCategory"];

export interface ExtractedFileMetadata {
  metadata: FileMetadata;
  /** Unencrypted `data:` URL preview, if one could be produced. */
  rawThumbnail?: string;
  aspectRatio?: number;
}

interface WorkerExtractResult {
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  duration: number | null;
  dateTaken: string | null;
  deviceModel: string | null;
  deviceBrand: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  jfifVersion: number | null;
  resolutionUnit: number | null;
  thumbnailHeight: number | null;
  thumbnailWidth: number | null;
  xResolution: number | null;
  yResolution: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  fps: number | null;
  audioSampleRate: number | null;
  audioChannels: string | null;
  creationTime: string | null;
  rawThumbnail: string | null;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  error?: string;
  result: WorkerExtractResult;
}

// A parse that overruns this is treated as hostile/broken: the worker is killed
// and recreated, and the caller falls back to basic metadata. Must exceed the
// worker's own internal timeouts (exif 8s / mediainfo 12s) with headroom.
const WORKER_HARD_TIMEOUT_MS = 20_000;
const VIDEO_THUMB_TIMEOUT_MS = 10_000;
const THUMB_MAX_SIZE = 320;
const THUMB_QUALITY = 0.8;
const INSPECTION_HEADER_BYTES = 1024 * 1024;


export function getMediaCategory(mimeType: string | null | undefined): MediaCategory {
  if (!mimeType) return "other";
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("xls") || m.includes("csv"))
    return "excel";
  if (m.includes("wordprocessing") || m.includes("word") || m.includes("doc")) return "word";
  if (m.includes("presentation") || m.includes("powerpoint") || m.includes("ppt"))
    return "powerpoint";
  if (m.includes("zip") || m.includes("tar") || m.includes("rar") || m.includes("7z") || m.includes("archive"))
    return "archive";
  if (
    m.includes("json") ||
    m.includes("javascript") ||
    m.includes("html") ||
    m.includes("xml") ||
    m.includes("text/css") ||
    m.includes("text/x-") ||
    m.includes("application/x-sh")
  )
    return "code";
  if (m.includes("document") || m.includes("text/")) return "document";
  return "other";
}

// ── Worker lifecycle ─────────────────────────────────────────────────────────

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (res: WorkerResponse | null) => void>();

function spawnWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    const w = new Worker(new URL("./workers/metadata.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data);
      }
    };
    w.onerror = () => {
      // A hard worker error invalidates every in-flight request.
      killWorker();
    };
    return w;
  } catch {
    return null;
  }
}

function killWorker() {
  const dying = worker;
  worker = null;
  if (dying) {
    try {
      dying.terminate();
    } catch {
      /* noop */
    }
  }
  // Fail every outstanding request open so callers fall back to basic metadata.
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
}

function runWorker(
  file: File,
  category: "image" | "video" | "audio",
  imageMetrics: ImageMetrics | null,
): Promise<WorkerExtractResult | null> {
  if (!worker) worker = spawnWorker();
  const w = worker;
  if (!w) return Promise.resolve(null);

  const id = ++seq;
  return new Promise<WorkerExtractResult | null>((resolve) => {
    let settled = false;
    const finish = (res: WorkerResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res?.result ?? null);
    };
    pending.set(id, finish);

    const timer = setTimeout(() => {
      // Parser wedged past its own timeouts — nuke the worker (this rejects all
      // pending, including us) and recreate lazily on the next request.
      if (!settled) killWorker();
    }, WORKER_HARD_TIMEOUT_MS);

    try {
      w.postMessage({ id, file, category, imageMetrics });
    } catch {
      pending.delete(id);
      finish(null);
    }
  });
}

// ── Main-thread video thumbnail (no <video> in a worker) ─────────────────────

function makeVideoThumbnail(
  file: File,
): Promise<{ rawThumbnail: string; aspectRatio: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    let attempts = 0;

    const finish = (result: { rawThumbnail: string; aspectRatio: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* noop */
      }
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), VIDEO_THUMB_TIMEOUT_MS);

    const drawFrame = () => {
      if (settled) return;
      const sw = video.videoWidth;
      const sh = video.videoHeight;
      if (!sw || !sh || video.readyState < 2) {
        attempts += 1;
        if (attempts < 12) {
          requestAnimationFrame(drawFrame);
        } else {
          finish(null);
        }
        return;
      }
      const aspectRatio = sw / sh;
      let w = sw;
      let h = sh;
      if (w > h) {
        if (w > THUMB_MAX_SIZE) {
          h = Math.round((h * THUMB_MAX_SIZE) / w);
          w = THUMB_MAX_SIZE;
        }
      } else if (h > THUMB_MAX_SIZE) {
        w = Math.round((w * THUMB_MAX_SIZE) / h);
        h = THUMB_MAX_SIZE;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish({ rawThumbnail: canvas.toDataURL("image/jpeg", THUMB_QUALITY), aspectRatio });
      } catch {
        finish(null);
      }
    };

    video.muted = true;
    video.preload = "metadata";
    video.onloadeddata = () => {
      // Seek a touch into the clip to skip black leading frames.
      try {
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      } catch {
        drawFrame();
      }
    };
    video.onseeked = drawFrame;
    video.onerror = () => finish(null);
    video.src = url;
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

type ParserCategory = "image" | "video" | "audio";
interface MetadataInspection {
  parserCategory: ParserCategory | null;
  imageMetrics: ImageMetrics | null;
}

async function inspectForMetadata(file: File): Promise<MetadataInspection> {
  try {
    const headerSize = Math.min(file.size, INSPECTION_HEADER_BYTES);
    const bytes = new Uint8Array(
      await file.slice(0, headerSize).arrayBuffer(),
    );
    const inspected = inspectFileHeader(bytes, file.name, file.type, file.size);
    if (!inspected.signatureMatched) return { parserCategory: null, imageMetrics: null };
    if (inspected.kind === "image") {
      return { parserCategory: "image", imageMetrics: inspected.imageMetrics };
    }
    if (inspected.kind === "media") {
      const detectedMime = inspected.detectedMime ?? "";
      if (detectedMime.startsWith("audio/")) return { parserCategory: "audio", imageMetrics: null };
      if (detectedMime.startsWith("video/")) return { parserCategory: "video", imageMetrics: null };
      const claimed = getMediaCategory(file.type);
      return {
        parserCategory: claimed === "audio" || claimed === "video" ? claimed : null,
        imageMetrics: null,
      };
    }
    return { parserCategory: null, imageMetrics: null };
  } catch {
    return { parserCategory: null, imageMetrics: null };
  }
}

/**
 * Extract standardized metadata for a file, plus a raw (unencrypted) thumbnail
 * data URL where one can be produced. Never throws — callers get basic metadata
 * even when parsing fails or is unavailable.
 */
export async function extractFileMetadata(
  file: File,
  options: { aspectRatio?: number } = {},
): Promise<ExtractedFileMetadata> {
  const claimedCategory = getMediaCategory(file.type);
  const inspection = await inspectForMetadata(file);
  const parserCategory = inspection.parserCategory;
  const category: MediaCategory =
    claimedCategory === "image" || claimedCategory === "video" || claimedCategory === "audio" || parserCategory
      ? (parserCategory ?? "other")
      : claimedCategory;
  const extension = file.name.includes(".")
    ? (file.name.split(".").pop()?.toLowerCase() ?? null)
    : null;

  let parsed: WorkerExtractResult | null = null;
  let videoThumb: { rawThumbnail: string; aspectRatio: number } | null = null;

  if (category === "image" || category === "video" || category === "audio") {
    const parsePromise = runWorker(file, category, inspection.imageMetrics).catch(() => null);
    const videoPromise =
      category === "video" ? makeVideoThumbnail(file).catch(() => null) : Promise.resolve(null);
    [parsed, videoThumb] = await Promise.all([parsePromise, videoPromise]);
  }

  const rawThumbnail = parsed?.rawThumbnail ?? videoThumb?.rawThumbnail ?? undefined;
  const aspectRatio =
    options.aspectRatio ?? parsed?.aspectRatio ?? videoThumb?.aspectRatio ?? undefined;

  const metadata: FileMetadata = {
    version: 1,
    extractedAt: Date.now(),
    name: file.name,
    extension,
    size: file.size,
    type: file.type || null,
    lastModified: file.lastModified,
    mediaCategory: category,
    width: parsed?.width ?? null,
    height: parsed?.height ?? null,
    aspectRatio: aspectRatio ?? null,
    duration: parsed?.duration ?? null,
    dateTaken: parsed?.dateTaken ?? null,
    deviceModel: parsed?.deviceModel ?? null,
    deviceBrand: parsed?.deviceBrand ?? null,
    gpsLatitude: parsed?.gpsLatitude ?? null,
    gpsLongitude: parsed?.gpsLongitude ?? null,
    jfifVersion: parsed?.jfifVersion ?? null,
    resolutionUnit: parsed?.resolutionUnit ?? null,
    thumbnailHeight: parsed?.thumbnailHeight ?? null,
    thumbnailWidth: parsed?.thumbnailWidth ?? null,
    xResolution: parsed?.xResolution ?? null,
    yResolution: parsed?.yResolution ?? null,
    videoCodec: parsed?.videoCodec ?? null,
    audioCodec: parsed?.audioCodec ?? null,
    bitrate: parsed?.bitrate ?? null,
    fps: parsed?.fps ?? null,
    audioSampleRate: parsed?.audioSampleRate ?? null,
    audioChannels: parsed?.audioChannels ?? null,
    creationTime: parsed?.creationTime ?? null,
    thumbnail: null,
    chunkSize: null,
    chunkCount: null,
    chunkIvs: null,
    hash: null,
  };

  return { metadata, rawThumbnail, aspectRatio };
}
