import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreviewProgress =
  | { stage: "optimizing"; progress: number }
  | { stage: "done" }
  | { stage: "skipped" };

export type PreviewResult = {
  preview: File;
  original: File;
  aspectRatio?: number; // width / height
};

// ─── Format maps ─────────────────────────────────────────────────────────────

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

const SKIP_EXTENSIONS = new Set(["webp", "gif"]);
const SKIP_MIME = new Set(["image/webp", "image/gif"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function makePreviewName(originalName: string): string {
  return `${originalName.replace(/\.[^.]+$/, "")}_preview.webp`;
}

// ─── Canvas compressor ────────────────────────────────────────────────────────

const QUALITY_PHOTO = 0.82;
const QUALITY_GRAPHIC = 0.88;
const QUALITY_INTERMEDIATE = 0.85;
const MAX_DIMENSION = 2048;

async function compressWithCanvas(
  file: File,
  originalName: string,
  quality: number,
  onProgress?: (p: PreviewProgress) => void,
): Promise<{ file: File; aspectRatio: number }> {
  onProgress?.({ stage: "optimizing", progress: 10 });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Cannot decode image: ${file.name}`);
  }

  onProgress?.({ stage: "optimizing", progress: 40 });

  const aspectRatio = bitmap.width / bitmap.height;

  let width = bitmap.width;
  let height = bitmap.height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false })!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  onProgress?.({ stage: "optimizing", progress: 80 });

  const blob = await canvas.convertToBlob({ type: "image/webp", quality });

  onProgress?.({ stage: "optimizing", progress: 100 });

  return {
    file: new File([blob], makePreviewName(originalName), {
      type: "image/webp",
      lastModified: Date.now(),
    }),
    aspectRatio,
  };
}

// ─── HEIC handler ─────────────────────────────────────────────────────────────

async function heicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;

  const blob = (await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.95,
  })) as Blob;

  return new File([blob], "heic_intermediate.jpg", { type: "image/jpeg" });
}

// ─── RAW handler ──────────────────────────────────────────────────────────────

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

  const blob = new Blob([bytes.slice(start, end + 2)], { type: "image/jpeg" });
  return new File([blob], "raw_preview.jpg", { type: "image/jpeg" });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

    const { file: previewFile, aspectRatio } = await compressWithCanvas(
      intermediate,
      file.name,
      quality,
      onProgress,
    );

    onProgress?.({ stage: "done" });

    return {
      preview: previewFile.size < file.size ? previewFile : file,
      original: file,
      aspectRatio,
    };
  } catch (err) {
    console.warn(`[Preview] Skipped for ${file.name}:`, err);
    onProgress?.({ stage: "skipped" });
    return { preview: file, original: file };
  }
}
