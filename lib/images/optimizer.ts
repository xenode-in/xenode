// Types

export type PreviewProgress =
  | { stage: "optimizing"; progress: number }
  | { stage: "done" }
  | { stage: "skipped" };

export type PreviewResult = {
  preview: File;
  original: File;
  aspectRatio?: number; // width / height
};

// Format maps

const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const HEIC_MIME = new Set(["image/heic", "image/heif"]);

const RAW_EXTENSIONS = new Set([
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
]);

const SKIP_EXTENSIONS = new Set(["gif"]);
const SKIP_MIME = new Set(["image/gif"]);

// Helpers

function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function makePreviewName(originalName: string, ext: string): string {
  return `${originalName.replace(/\.[^.]+$/, "")}_preview.${ext}`;
}

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  try {
    return await Promise.race([work, sleep(timeoutMs)]);
  } catch (err) {
    throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type CanvasLike = OffscreenCanvas | HTMLCanvasElement;
type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: CanvasLike): Canvas2DContext {
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as Canvas2DContext | null;
  if (!ctx) throw new Error("Cannot create 2D canvas context");
  return ctx;
}

function canvasToBlob(
  canvas: CanvasLike,
  type: string,
  quality?: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Canvas encode returned no ${type} blob`));
      },
      type,
      quality,
    );
  });
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
        };
      } catch {
        // Fall through to the HTMLImageElement decoder below.
      }
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;

  try {
    if (typeof img.decode === "function") {
      await img.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Cannot decode image: ${file.name}`));
      });
    }

    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof Error ? err : new Error(`Cannot decode image: ${file.name}`);
  }
}

function hasTransparency(imageData: ImageData): boolean {
  const { data } = imageData;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

// Preview encoder
//
// iOS Safari can report a successful WebP canvas encode while returning a large
// PNG-like blob. WASM encoders can also fail softly under mobile memory pressure.
// Every tier below must prove its output is meaningfully smaller before it is
// accepted as the optimized sidecar.

const QUALITY_PHOTO = 55;
const QUALITY_GRAPHIC = 65;
const QUALITY_INTERMEDIATE = 60;
const AVIF_SPEED = 8;
const WEBP_FALLBACK_QUALITY = 75;
const JPEG_FALLBACK_QUALITIES = [0.72, 0.62, 0.52, 0.44, 0.36];
const JPEG_FALLBACK_SCALES = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.22];
const MAX_DIMENSION = 1600;
const WASM_TIMEOUT_MS = 15_000;
const TARGET_PREVIEW_BYTES = 500 * 1024;
const MIN_COMPRESSION_RATIO = 0.75;
const MAX_BYTES_PER_PIXEL = 0.85;

type EncodedPreview = {
  blob: Blob;
  ext: string;
  mime: string;
  label: string;
};

type RasterPreview = {
  canvas: CanvasLike;
  imageData: ImageData;
  aspectRatio: number;
  width: number;
  height: number;
  pixels: number;
  hasAlpha: boolean;
};

function targetPreviewBytes(originalSize: number, pixels: number): number {
  const ratioCeiling = originalSize * MIN_COMPRESSION_RATIO;
  const pixelCeiling = pixels * MAX_BYTES_PER_PIXEL;
  return Math.min(TARGET_PREVIEW_BYTES, ratioCeiling, pixelCeiling);
}

function isUsefulPreview(candidate: Blob, targetBytes: number): boolean {
  return candidate.size > 0 && candidate.size <= targetBytes;
}

async function encodeAvif(
  imageData: ImageData,
  quality: number,
): Promise<EncodedPreview> {
  const encode = (await import("@jsquash/avif/encode")).default;
  const buf = await withTimeout(
    encode(imageData, { quality, speed: AVIF_SPEED }),
    WASM_TIMEOUT_MS,
    "AVIF encode",
  );

  return {
    blob: new Blob([buf as BlobPart], { type: "image/avif" }),
    ext: "avif",
    mime: "image/avif",
    label: "AVIF",
  };
}

async function encodeWebp(imageData: ImageData): Promise<EncodedPreview> {
  const encode = (await import("@jsquash/webp/encode")).default;
  const buf = await withTimeout(
    encode(imageData, {
      quality: WEBP_FALLBACK_QUALITY,
      method: 4,
    }),
    WASM_TIMEOUT_MS,
    "WebP encode",
  );

  return {
    blob: new Blob([buf as BlobPart], { type: "image/webp" }),
    ext: "webp",
    mime: "image/webp",
    label: "WebP",
  };
}

function drawScaledCanvas(source: CanvasLike, width: number, height: number): CanvasLike {
  const canvas = createCanvas(width, height);
  const ctx = getCanvasContext(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function encodeJpegFallback(
  canvas: CanvasLike,
  width: number,
  height: number,
  targetBytes: number,
): Promise<EncodedPreview[]> {
  const attempts: EncodedPreview[] = [];

  for (const scale of JPEG_FALLBACK_SCALES) {
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    const scaledCanvas =
      scale === 1 ? canvas : drawScaledCanvas(canvas, scaledWidth, scaledHeight);

    for (const quality of JPEG_FALLBACK_QUALITIES) {
      const blob = await canvasToBlob(scaledCanvas, "image/jpeg", quality);
      attempts.push({
        blob,
        ext: "jpg",
        mime: "image/jpeg",
        label: `JPEG ${scaledWidth}x${scaledHeight} q${quality}`,
      });

      if (isUsefulPreview(blob, targetBytes)) return attempts;
    }
  }

  return attempts;
}

async function buildRasterPreview(file: File): Promise<RasterPreview> {
  const decoded = await decodeImage(file);
  const aspectRatio = decoded.width / decoded.height;

  let width = decoded.width;
  let height = decoded.height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = createCanvas(width, height);
  const ctx = getCanvasContext(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  try {
    ctx.drawImage(decoded.source, 0, 0, width, height);
  } finally {
    decoded.close();
  }

  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    canvas,
    imageData,
    aspectRatio,
    width,
    height,
    pixels: width * height,
    hasAlpha: hasTransparency(imageData),
  };
}

function flattenAlphaForJpeg(raster: RasterPreview): CanvasLike {
  if (!raster.hasAlpha) return raster.canvas;

  const canvas = createCanvas(raster.imageData.width, raster.imageData.height);
  const ctx = getCanvasContext(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, raster.imageData.width, raster.imageData.height);
  ctx.drawImage(raster.canvas, 0, 0);
  return canvas;
}

async function compressWithVerifiedEncoders(
  file: File,
  originalName: string,
  originalSize: number,
  quality: number,
  onProgress?: (p: PreviewProgress) => void,
): Promise<{ file: File | null; aspectRatio: number }> {
  onProgress?.({ stage: "optimizing", progress: 10 });

  const raster = await buildRasterPreview(file);
  const targetBytes = targetPreviewBytes(originalSize, raster.pixels);
  const attempts: EncodedPreview[] = [];

  onProgress?.({ stage: "optimizing", progress: 45 });

  try {
    attempts.push(await encodeAvif(raster.imageData, quality));
  } catch (err) {
    console.warn("[Preview] AVIF encode failed:", err);
  }

  onProgress?.({ stage: "optimizing", progress: 65 });

  try {
    attempts.push(await encodeWebp(raster.imageData));
  } catch (err) {
    console.warn("[Preview] WebP encode failed:", err);
  }

  onProgress?.({ stage: "optimizing", progress: 85 });

  try {
    attempts.push(
      ...(await encodeJpegFallback(
        flattenAlphaForJpeg(raster),
        raster.width,
        raster.height,
        targetBytes,
      )),
    );
  } catch (err) {
    console.warn("[Preview] JPEG fallback failed:", err);
  }

  const accepted = attempts
    .filter((attempt) => isUsefulPreview(attempt.blob, targetBytes))
    .sort((a, b) => a.blob.size - b.blob.size)[0];

  onProgress?.({ stage: "optimizing", progress: 100 });

  if (!accepted) {
    const bestAttempt = attempts.sort((a, b) => a.blob.size - b.blob.size)[0];
    console.warn("[Preview] No useful optimized image produced", {
      originalSize,
      targetBytes,
      bestSize: bestAttempt?.blob.size,
      bestEncoder: bestAttempt?.label,
      pixels: raster.pixels,
    });

    if (bestAttempt && bestAttempt.blob.size < originalSize) {
      return {
        file: new File([bestAttempt.blob], makePreviewName(originalName, bestAttempt.ext), {
          type: bestAttempt.mime,
          lastModified: Date.now(),
        }),
        aspectRatio: raster.aspectRatio,
      };
    }

    return { file: null, aspectRatio: raster.aspectRatio };
  }

  return {
    file: new File([accepted.blob], makePreviewName(originalName, accepted.ext), {
      type: accepted.mime,
      lastModified: Date.now(),
    }),
    aspectRatio: raster.aspectRatio,
  };
}

// HEIC handler

async function heicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;

  const blob = (await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.95,
  })) as Blob;

  return new File([blob], "heic_intermediate.jpg", { type: "image/jpeg" });
}

// RAW handler

function findBytes(haystack: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function extractRawPreview(file: File): Promise<File> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const start = findBytes(bytes, [0xff, 0xd8, 0xff]);
  if (start === -1) throw new Error("No embedded JPEG found in RAW file");

  const end = findBytes(bytes, [0xff, 0xd9], start);
  if (end === -1) throw new Error("Incomplete JPEG in RAW file");

  const blob = new Blob([bytes.slice(start, end + 2) as BlobPart], { type: "image/jpeg" });
  return new File([blob], "raw_preview.jpg", { type: "image/jpeg" });
}

// Main

export async function generatePreview(
  file: File,
  onProgress?: (p: PreviewProgress) => void,
): Promise<PreviewResult> {
  const fileExt = ext(file.name);

  if (SKIP_MIME.has(file.type) || SKIP_EXTENSIONS.has(fileExt)) {
    onProgress?.({ stage: "skipped" });
    return { preview: file, original: file };
  }

  try {
    let intermediate: File;
    let quality: number;

    if (HEIC_MIME.has(file.type) || HEIC_EXTENSIONS.has(fileExt)) {
      intermediate = await heicToJpeg(file);
      quality = QUALITY_INTERMEDIATE;
    } else if (RAW_EXTENSIONS.has(fileExt)) {
      intermediate = await extractRawPreview(file);
      quality = QUALITY_INTERMEDIATE;
    } else if (file.type === "image/jpeg" || file.type === "image/jpg") {
      intermediate = file;
      quality = QUALITY_PHOTO;
    } else if (file.type.startsWith("image/")) {
      intermediate = file;
      quality = QUALITY_GRAPHIC;
    } else {
      onProgress?.({ stage: "skipped" });
      return { preview: file, original: file };
    }

    const { file: previewFile, aspectRatio } = await compressWithVerifiedEncoders(
      intermediate,
      file.name,
      file.size,
      quality,
      onProgress,
    );

    if (!previewFile) {
      onProgress?.({ stage: "skipped" });
      return { preview: file, original: file, aspectRatio };
    }

    onProgress?.({ stage: "done" });

    return {
      preview: previewFile,
      original: file,
      aspectRatio,
    };
  } catch (err) {
    console.warn(`[Preview] Skipped for ${file.name}:`, err);
    onProgress?.({ stage: "skipped" });
    return { preview: file, original: file };
  }
}
