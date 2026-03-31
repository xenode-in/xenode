import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreviewResult = {
  preview: File; // Optimized WebP — show this in UI
  original: File; // Untouched original — encrypt & store this
};

// ─── Format maps ─────────────────────────────────────────────────────────────

const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const HEIC_MIME = new Set(["image/heic", "image/heif"]);

const RAW_EXTENSIONS = new Set([
  "cr2",
  "cr3", // Canon
  "nef",
  "nrw", // Nikon
  "arw",
  "srf", // Sony
  "dng", // Adobe / iPhone ProRAW
  "raf", // Fujifilm
  "rw2", // Panasonic
  "orf", // Olympus
  "pef", // Pentax
]);

const SKIP_EXTENSIONS = new Set(["webp", "gif"]);
const SKIP_MIME = new Set(["image/webp", "image/gif"]);

// ─── FFmpeg singleton ─────────────────────────────────────────────────────────

let ffmpeg: FFmpeg | null = null;

async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
    wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
  });
  return ffmpeg;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

// ─── HEIC → JPEG (intermediate) ───────────────────────────────────────────────

async function heicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;

  const blob = (await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.92,
  })) as Blob;

  return new File([blob], "heic_intermediate.jpg", { type: "image/jpeg" });
}
// ─── RAW → embedded JPEG extraction ───────────────────────────────────────────
// Every RAW file embeds a full-res JPEG preview baked in by the camera.
// We scan the binary for the JPEG SOI/EOI markers to extract it — no WASM needed.

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

  // Scan for EOI marker (0xFF 0xD9) after the start
  const end = findBytes(bytes, [0xff, 0xd9], start);
  if (end === -1) throw new Error("Incomplete JPEG in RAW file");

  const jpegBytes = bytes.slice(start, end + 2);
  const blob = new Blob([jpegBytes], { type: "image/jpeg" });
  return new File([blob], "raw_preview.jpg", { type: "image/jpeg" });
}

// ─── FFmpeg compression ───────────────────────────────────────────────────────

async function compressToWebP(file: File, originalName: string): Promise<File> {
  const ff = await loadFFmpeg();
  const inputName = `in_${crypto.randomUUID()}`;
  const outputName = `out_${crypto.randomUUID()}.webp`;

  await ff.writeFile(inputName, await fetchFile(file));

  const isPhoto = file.type === "image/jpeg" || file.type === "image/jpg";
  const dim = "2048";

  await ff.exec([
    "-i",
    inputName,
    "-vf",
    `scale='if(gt(iw,ih),min(iw,${dim}),-2)':'if(gt(ih,iw),min(ih,${dim}),-2)'`,
    "-c:v",
    "libwebp",
    "-quality",
    isPhoto ? "75" : "82",
    "-compression_level",
    "6",
    "-preset",
    isPhoto ? "photo" : "drawing",
    "-loop",
    "0",
    "-an", // strip audio
    "-sn", // strip subtitles
    "-map_metadata",
    "-1", // strip ALL EXIF — GPS, device info, timestamps
    outputName,
  ]);

  const data = await ff.readFile(outputName);
  const blob = new Blob([new Uint8Array(data as any).buffer], {
    type: "image/webp",
  });

  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);

  const baseName = originalName.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}_preview.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generatePreview(file: File): Promise<PreviewResult> {
  const fileExt = ext(file.name);

  // 1. Already optimal — use as preview directly
  if (SKIP_MIME.has(file.type) || SKIP_EXTENSIONS.has(fileExt)) {
    return { preview: file, original: file };
  }

  try {
    let intermediate: File;

    if (HEIC_MIME.has(file.type) || HEIC_EXTENSIONS.has(fileExt)) {
      // HEIC/HEIF (iPhone default format)
      intermediate = await heicToJpeg(file);
    } else if (RAW_EXTENSIONS.has(fileExt)) {
      // RAW files — extract embedded JPEG preview
      intermediate = await extractRawPreview(file);
    } else if (file.type.startsWith("image/")) {
      // JPEG, PNG, BMP, TIFF, etc.
      intermediate = file;
    } else {
      // Not an image — no preview
      return { preview: file, original: file };
    }

    const preview = await compressToWebP(intermediate, file.name);

    // Safety: only use preview if it's actually smaller
    return {
      preview: preview.size < file.size ? preview : file,
      original: file, // ← always the untouched original
    };
  } catch (err) {
    console.error(`[Preview] Failed for ${file.name}:`, err);
    // Original is still safe — preview generation failing is non-fatal
    return { preview: file, original: file };
  }
}
