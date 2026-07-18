/// <reference lib="webworker" />
/**
 * Hardened metadata + image-thumbnail worker.
 *
 * This is a CLASSIC worker on purpose — it deliberately has NO import/export
 * statements so the bundler keeps it a script (not an ES module) and
 * `importScripts` stays available. The two hostile-file parsers are loaded from
 * same-origin /public UMD bundles:
 *
 *   • exifr     — image header / EXIF parser (pure JS)  → /exifr/exifr.js
 *   • mediainfo — media-container analyzer (WASM)        → /mediainfo/mediainfo.js
 *
 * Why a worker: a maliciously crafted file that hangs, loops, or crashes a
 * parser takes down THIS worker — which the main-thread client recreates — and
 * never freezes the UI. The worker is never handed the user's decryption keys,
 * so even a worst-case out-of-bounds fault inside the mediainfo WASM sandbox
 * runs in an address space that holds no key material.
 *
 * Everything here is best-effort: any failure resolves to nulls so the caller
 * always gets a usable (basic) metadata record and the upload never blocks.
 */

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
  /** Unencrypted `data:` URL of a downscaled JPEG preview (images only). */
  rawThumbnail: string | null;
}

function emptyResult(): WorkerExtractResult {
  return {
    width: null,
    height: null,
    aspectRatio: null,
    duration: null,
    dateTaken: null,
    deviceModel: null,
    deviceBrand: null,
    gpsLatitude: null,
    gpsLongitude: null,
    jfifVersion: null,
    resolutionUnit: null,
    thumbnailHeight: null,
    thumbnailWidth: null,
    xResolution: null,
    yResolution: null,
    videoCodec: null,
    audioCodec: null,
    bitrate: null,
    fps: null,
    audioSampleRate: null,
    audioChannels: null,
    creationTime: null,
    rawThumbnail: null,
  };
}

const THUMB_MAX_SIZE = 320;
const THUMB_QUALITY = 0.8;
const EXIF_TIMEOUT_MS = 8_000;
const MEDIAINFO_TIMEOUT_MS = 12_000;
const THUMB_TIMEOUT_MS = 8_000;
// Decompression-bomb guard: refuse to rasterize absurd source dimensions into
// memory (e.g. a 100k×100k "image" whose header claims 10 GP). 100 MP ceiling.
const MAX_THUMB_SOURCE_PIXELS = 40_000_000;
const MAX_THUMB_SOURCE_DIMENSION = 16_384;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const loaded = { exif: false, media: false };

function getExifr(): { parse: (input: Blob, opts?: unknown) => Promise<AnyRecord | null> } | null {
  if (!loaded.exif) {
    importScripts("/exifr/exifr.js");
    loaded.exif = true;
  }
  return (self as unknown as { exifr?: { parse: (input: Blob, opts?: unknown) => Promise<AnyRecord | null> } }).exifr ?? null;
}

function getMediaInfoFactory(): ((opts: AnyRecord) => Promise<AnyRecord>) | null {
  if (!loaded.media) {
    importScripts("/mediainfo/mediainfo.js");
    loaded.media = true;
  }
  const g = (self as unknown as { MediaInfo?: AnyRecord }).MediaInfo;
  return (g?.default ?? g?.mediaInfoFactory ?? null) as ((opts: AnyRecord) => Promise<AnyRecord>) | null;
}

/** Resolve `p` but fall back to `fallback` if it rejects or overruns `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const finish = (v: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    p.then(finish).catch(() => finish(fallback));
  });
}

async function extractExif(file: Blob): Promise<Partial<WorkerExtractResult>> {
  const exifr = getExifr();
  if (!exifr?.parse) return {};
  const data = await exifr.parse(file, true).catch(() => null);
  if (!data) return {};
  const width = data.ExifImageWidth || data.ImageWidth || null;
  const height = data.ExifImageHeight || data.ImageHeight || null;
  const toIso = (v: unknown): string | null =>
    v && typeof (v as Date).toISOString === "function" ? (v as Date).toISOString() : null;
  return {
    dateTaken: toIso(data.DateTimeOriginal) ?? toIso(data.CreateDate),
    deviceBrand: data.Make ?? null,
    deviceModel: data.Model ?? null,
    width: width || null,
    height: height || null,
    aspectRatio: width && height ? width / height : null,
    gpsLatitude: typeof data.latitude === "number" ? data.latitude : null,
    gpsLongitude: typeof data.longitude === "number" ? data.longitude : null,
    jfifVersion: data.JFIFVersion ?? null,
    resolutionUnit: data.ResolutionUnit ?? null,
    thumbnailHeight: data.ThumbnailHeight ?? null,
    thumbnailWidth: data.ThumbnailWidth ?? null,
    xResolution: data.XResolution ?? null,
    yResolution: data.YResolution ?? null,
  };
}

async function extractMedia(file: File): Promise<Partial<WorkerExtractResult>> {
  const factory = getMediaInfoFactory();
  if (!factory) return {};
  const mediainfo = await factory({
    format: "object",
    locateFile: (path: string) => `/mediainfo/${path}`,
  });
  try {
    const getSize = () => file.size;
    const readChunk = async (size: number, offset: number): Promise<Uint8Array> =>
      new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
    const info = (await mediainfo.analyzeData(getSize, readChunk)) as AnyRecord;
    const tracks: AnyRecord[] = info?.media?.track ?? [];
    const general = tracks.find((t) => t["@type"] === "General");
    const video = tracks.find((t) => t["@type"] === "Video");
    const audio = tracks.find((t) => t["@type"] === "Audio");
    const w = video?.Width ? parseInt(video.Width, 10) : null;
    const h = video?.Height ? parseInt(video.Height, 10) : null;
    return {
      videoCodec: video?.Format ?? null,
      width: Number.isFinite(w) ? w : null,
      height: Number.isFinite(h) ? h : null,
      aspectRatio: w && h ? w / h : null,
      fps: video?.FrameRate ? parseFloat(video.FrameRate) : null,
      audioCodec: audio?.Format ?? null,
      audioSampleRate: audio?.SamplingRate ? parseInt(audio.SamplingRate, 10) : null,
      audioChannels: audio?.Channels != null ? String(audio.Channels) : null,
      duration: general?.Duration ? parseFloat(general.Duration) : null,
      bitrate: general?.OverallBitRate ? parseInt(general.OverallBitRate, 10) : null,
      creationTime: general?.Encoded_Date ?? general?.Tagged_Date ?? null,
    };
  } finally {
    try {
      (mediainfo as { close?: () => void }).close?.();
    } catch {
      /* noop */
    }
  }
}

function blobToDataURL(blob: Blob): string {
  // FileReaderSync is only available inside workers — perfect here.
  const reader = new FileReaderSync();
  return reader.readAsDataURL(blob);
}

async function makeImageThumbnail(
  file: Blob,
  knownWidth: number | null,
  knownHeight: number | null,
): Promise<{ rawThumbnail: string; width: number; height: number; aspectRatio: number } | null> {
  // Canonical dimensions come from signature inspection of the real image
  // header. Unknown, oversized, or otherwise uninspectable images never reach
  // the browser decoder.
  if (
    !knownWidth ||
    !knownHeight ||
    !Number.isFinite(knownWidth) ||
    !Number.isFinite(knownHeight) ||
    knownWidth > MAX_THUMB_SOURCE_DIMENSION ||
    knownHeight > MAX_THUMB_SOURCE_DIMENSION ||
    knownWidth * knownHeight > MAX_THUMB_SOURCE_PIXELS
  ) {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    // Native, browser-hardened, sandboxed image decode — same code path that
    // renders every <img> on the web.
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const sw = bitmap.width;
    const sh = bitmap.height;
    const dimensionsMatchHeader =
      (sw === knownWidth && sh === knownHeight) ||
      (sw === knownHeight && sh === knownWidth);
    if (!sw || !sh || !dimensionsMatchHeader || sw * sh > MAX_THUMB_SOURCE_PIXELS) {
      return null;
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
    const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: THUMB_QUALITY });
    return { rawThumbnail: blobToDataURL(blob), width: sw, height: sh, aspectRatio };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

interface ExtractRequest {
  id: number;
  file: File;
  category: "image" | "video" | "audio" | "other";
  imageMetrics: { width: number | null; height: number | null } | null;
}

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const { id, file, category, imageMetrics } = event.data;
  const result = emptyResult();
  try {
    if (category === "image") {
      // EXIF first (cheap header parse) so its dimensions can gate the decode.
      const exif = await withTimeout(
        extractExif(file),
        EXIF_TIMEOUT_MS,
        {} as Partial<WorkerExtractResult>,
      );
      Object.assign(result, exif);
      const thumb = await withTimeout(
        makeImageThumbnail(file, imageMetrics?.width ?? null, imageMetrics?.height ?? null),
        THUMB_TIMEOUT_MS,
        null,
      );
      if (thumb) {
        result.rawThumbnail = thumb.rawThumbnail;
        result.width = result.width ?? thumb.width;
        result.height = result.height ?? thumb.height;
        result.aspectRatio = result.aspectRatio ?? thumb.aspectRatio;
      }
    } else if (category === "video" || category === "audio") {
      const media = await withTimeout(
        extractMedia(file),
        MEDIAINFO_TIMEOUT_MS,
        {} as Partial<WorkerExtractResult>,
      );
      Object.assign(result, media);
    }
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : "metadata_worker_failed",
      result,
    });
  }
};
