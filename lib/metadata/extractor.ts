/**
 * lib/metadata/extractor.ts
 * Robust client-side metadata extraction for Xenode.
 */

import exifr from "exifr";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { FileMetadata } from "./types";

let ffmpeg: FFmpeg | null = null;

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  const baseURL = "/ffmpeg"; // Core files must be in public/ffmpeg
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  return ffmpeg;
}

function getMediaCategory(mimeType: string): FileMetadata["mediaCategory"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("msword") ||
    mimeType.includes("vnd.openxmlformats-officedocument")
  )
    return "document";
  return "other";
}

/**
 * Main entry point for metadata extraction.
 */
export async function extractMetadata(
  file: File,
  options: {
    thumbnail?: string | null;
    aspectRatio?: number | null;
    chunkSize?: number | null;
    chunkCount?: number | null;
    chunkIvs?: string[] | null;
  } = {},
): Promise<FileMetadata> {
  const basic = extractBasicMetadata(file);
  const mediaCategory = basic.mediaCategory;

  let exifData: Partial<FileMetadata> = {};
  let ffmpegData: Partial<FileMetadata> = {};

  if (mediaCategory === "image") {
    exifData = await extractExifMetadata(file).catch(() => ({}));
    // Also try to get dimensions via Image API if EXIF fails
    if (!exifData.width || !exifData.height) {
      const dimensions = await getImageDimensions(file).catch(() => null);
      if (dimensions) {
        exifData.width = dimensions.width;
        exifData.height = dimensions.height;
        exifData.aspectRatio = dimensions.width / dimensions.height;
      }
    }
  } else if (mediaCategory === "video" || mediaCategory === "audio") {
    ffmpegData = await extractFfmpegMetadata(file).catch(() => ({}));
  }

  // Final normalization with null fallbacks
  const metadata: FileMetadata = {
    version: 1,
    extractedAt: Date.now(),

    // BASIC
    name: basic.name ?? null,
    extension: basic.extension ?? null,
    size: basic.size ?? null,
    type: basic.type ?? null,
    lastModified: basic.lastModified ?? null,
    mediaCategory: basic.mediaCategory ?? null,

    // Dimensions/Duration
    width: exifData.width ?? ffmpegData.width ?? null,
    height: exifData.height ?? ffmpegData.height ?? null,
    aspectRatio: options.aspectRatio ?? exifData.aspectRatio ?? ffmpegData.aspectRatio ?? null,
    duration: ffmpegData.duration ?? null,

    // EXIF
    dateTaken: exifData.dateTaken ?? null,
    deviceModel: exifData.deviceModel ?? null,
    deviceBrand: exifData.deviceBrand ?? null,
    gpsLatitude: exifData.gpsLatitude ?? null,
    gpsLongitude: exifData.gpsLongitude ?? null,

    // JFIF / RESOLUTION
    jfifVersion: exifData.jfifVersion ?? null,
    resolutionUnit: exifData.resolutionUnit ?? null,
    thumbnailHeight: exifData.thumbnailHeight ?? null,
    thumbnailWidth: exifData.thumbnailWidth ?? null,
    xResolution: exifData.xResolution ?? null,
    yResolution: exifData.yResolution ?? null,

    // FFMPEG
    videoCodec: ffmpegData.videoCodec ?? null,
    audioCodec: ffmpegData.audioCodec ?? null,
    bitrate: ffmpegData.bitrate ?? null,
    fps: ffmpegData.fps ?? null,
    audioSampleRate: ffmpegData.audioSampleRate ?? null,
    audioChannels: ffmpegData.audioChannels ?? null,
    creationTime: ffmpegData.creationTime ?? null,

    // APP-LEVEL
    thumbnail: options.thumbnail ?? null,
    chunkSize: options.chunkSize ?? null,
    chunkCount: options.chunkCount ?? null,
    chunkIvs: options.chunkIvs ?? null,

    // EXT
    hash: null, // Placeholder for future use
  };

  return metadata;
}

function extractBasicMetadata(file: File) {
  const nameParts = file.name.split(".");
  const extension = nameParts.length > 1 ? nameParts.pop()?.toLowerCase() : "";
  return {
    name: file.name,
    extension: extension || null,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    mediaCategory: getMediaCategory(file.type),
  };
}

async function extractExifMetadata(file: File): Promise<Partial<FileMetadata>> {
  // Parse everything available in the image headers
  const data = await exifr.parse(file, true).catch(() => null);

  if (!data) {
    console.log("[Metadata Extractor] No EXIF data found for:", file.name);
    return {};
  }

  console.log(`[Metadata Extractor] EXIF Data for ${file.name}:`, data);

  const width = data.ExifImageWidth || data.ImageWidth;
  const height = data.ExifImageHeight || data.ImageHeight;

  return {
    dateTaken:
      data.DateTimeOriginal?.toISOString() ||
      data.CreateDate?.toISOString() ||
      null,
    deviceBrand: data.Make || null,
    deviceModel: data.Model || null,
    width: width || null,
    height: height || null,
    aspectRatio: width && height ? width / height : null,
    gpsLatitude: data.latitude || null,
    gpsLongitude: data.longitude || null,

    // JFIF / RESOLUTION
    jfifVersion: data.JFIFVersion || null,
    resolutionUnit: data.ResolutionUnit || null,
    thumbnailHeight: data.ThumbnailHeight || null,
    thumbnailWidth: data.ThumbnailWidth || null,
    xResolution: data.XResolution || null,
    yResolution: data.YResolution || null,
  };
}

async function extractFfmpegMetadata(
  file: File,
): Promise<Partial<FileMetadata>> {
  const ff = await loadFFmpeg();
  const inputName = "input_meta";
  await ff.writeFile(inputName, await fetchFile(file));

  let logs = "";
  const logHandler = ({ message }: { message: string }) => {
    logs += message + "\n";
  };
  ff.on("log", logHandler);

  // Run -i command to get metadata in stderr/logs
  await ff.exec(["-i", inputName]);

  ff.off("log", logHandler);
  await ff.deleteFile(inputName);

  return parseFfmpegLogs(logs);
}

function parseFfmpegLogs(logs: string): Partial<FileMetadata> {
  const result: Partial<FileMetadata> = {};

  // Duration: 00:00:10.05, start: 0.000000, bitrate: 1234 kb/s
  const durationMatch = logs.match(
    /Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/,
  );
  if (durationMatch) {
    const h = parseInt(durationMatch[1]);
    const m = parseInt(durationMatch[2]);
    const s = parseInt(durationMatch[3]);
    const ms = parseInt(durationMatch[4]);
    result.duration = h * 3600 + m * 60 + s + ms / 100;
  }

  const bitrateMatch = logs.match(/bitrate: (\d+) kb\/s/);
  if (bitrateMatch) result.bitrate = parseInt(bitrateMatch[1]);

  // Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 1000 kb/s, 30 fps
  const videoMatch = logs.match(
    /Video: ([^, ]+).*?,.*?, (\d+)x(\d+).*?,.*?(\d+(\.\d+)?) fps/,
  );
  if (videoMatch) {
    result.videoCodec = videoMatch[1];
    result.width = parseInt(videoMatch[2]);
    result.height = parseInt(videoMatch[3]);
    result.aspectRatio = result.width / result.height;
    result.fps = parseFloat(videoMatch[4]);
  }

  // Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
  const audioMatch = logs.match(/Audio: ([^, ]+).*?, (\d+) Hz, (.*?),/);
  if (audioMatch) {
    result.audioCodec = audioMatch[1];
    result.audioSampleRate = parseInt(audioMatch[2]);
    result.audioChannels = audioMatch[3];
  }

  // Creation Time
  const creationMatch = logs.match(
    /creation_time\s*:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
  );
  if (creationMatch) {
    result.creationTime = creationMatch[1] + "Z";
  }

  return result;
}

/**
 * Fallback to get image dimensions if EXIF fails or is missing.
 */
function getImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = img;
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}
