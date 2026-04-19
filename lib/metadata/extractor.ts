/**
 * lib/metadata/extractor.ts
 * Robust client-side metadata extraction for Xenode.
 */

import exifr from "exifr";
import MediaInfoFactory from "mediainfo.js";
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

    // FFMPEG / MEDIAINFO
    videoCodec: ffmpegData.videoCodec ?? null,
    audioCodec: ffmpegData.audioCodec ?? null,
    bitrate: ffmpegData.bitrate ?? null,
    fps: ffmpegData.fps ?? null,
    audioSampleRate: ffmpegData.audioSampleRate ?? null,
    audioChannels: ffmpegData.audioChannels ?? null,
    creationTime: ffmpegData.creationTime ?? null,
    
    // TRACKS
    audioTracks: ffmpegData.audioTracks ?? undefined,
    subtitleTracks: ffmpegData.subtitleTracks ?? undefined,

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

interface MediaInfoTrack {
  "@type": "General" | "Video" | "Audio" | "Text" | "Image";
  Format?: string;
  Width?: string;
  Height?: string;
  FrameRate?: string;
  Duration?: string;
  OverallBitRate?: string;
  SamplingRate?: string;
  Channels?: number;
  ID?: string;
  Language?: string;
  Title?: string;
  CodecID?: string;
}

interface MediaInfoResult {
  media?: {
    track?: MediaInfoTrack[];
  };
}

async function extractFfmpegMetadata(
  file: File,
): Promise<Partial<FileMetadata>> {
  const result: Partial<FileMetadata> = {};

  return new Promise((resolve) => {
    MediaInfoFactory({ format: "object" })
      .then((mediainfo) => {
        const getSize = () => file.size;
        const readChunk = (chunkSize: number, offset: number) => {
          return new Promise<Uint8Array>((resolveChunk, rejectChunk) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              if (e.target?.result) {
                resolveChunk(new Uint8Array(e.target.result as ArrayBuffer));
              } else {
                resolveChunk(new Uint8Array(0));
              }
            };
            reader.onerror = rejectChunk;
            reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
          });
        };

        mediainfo
          .analyzeData(getSize, readChunk)
          .then((info) => {
            const m = info as unknown as MediaInfoResult;
            if (m && m.media && m.media.track) {
              const general = m.media.track.find(
                (t) => t["@type"] === "General",
              );
              const video = m.media.track.find(
                (t) => t["@type"] === "Video",
              );
              const audios = m.media.track.filter(
                (t) => t["@type"] === "Audio",
              );
              const text = m.media.track.filter(
                (t) => t["@type"] === "Text",
              );

              if (video) {
                result.videoCodec = video.Format;
                result.width = video.Width ? parseInt(video.Width, 10) : undefined;
                result.height = video.Height ? parseInt(video.Height, 10) : undefined;
                result.fps = video.FrameRate ? parseFloat(video.FrameRate) : undefined;
                if (result.width && result.height) {
                  result.aspectRatio = result.width / result.height;
                }
              }
              if (audios.length > 0) {
                result.audioCodec = audios[0].Format;
                result.audioSampleRate = audios[0].SamplingRate ? parseInt(audios[0].SamplingRate, 10) : undefined;
                result.audioChannels = audios[0].Channels ? String(audios[0].Channels) : undefined;

                result.audioTracks = audios.map((a, index) => ({
                  id: a.ID || String(index),
                  language: a.Language || "und",
                  codec: a.Format || "unknown",
                  title: a.Title,
                }));
              }
              if (text.length > 0) {
                result.subtitleTracks = text.map((t, index) => ({
                  id: t.ID || String(index),
                  language: t.Language || "und",
                  format: t.Format || "unknown",
                  codec: t.CodecID,
                  title: t.Title,
                }));
              }
              if (general) {
                result.duration = general.Duration ? parseFloat(general.Duration) : undefined;
                result.bitrate = general.OverallBitRate ? parseInt(general.OverallBitRate, 10) : undefined;
              }
            }
            mediainfo.close();
            resolve(result);
          })
          .catch((err) => {
            mediainfo.close();
            console.error("[Metadata Extractor] Mediainfo error:", err);
            resolve(result);
          });
      })
      .catch((err) => {
        console.error("[Metadata Extractor] Failed to load mediainfo.js:", err);
        resolve(result);
      });
  });
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
