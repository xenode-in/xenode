/**
 * lib/metadata/types.ts
 * Standardized metadata structure for all files in Xenode.
 */

export interface FileMetadata {
  version: number;
  extractedAt: number;

  // BASIC FILE INFO (always present)
  name: string | null;
  extension: string | null;
  size: number | null;
  type: string | null;
  lastModified: number | null;
  mediaCategory: "image" | "video" | "audio" | "document" | "other" | null;

  // IMAGE / VIDEO COMMON
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  duration: number | null;

  // IMAGE (EXIF)
  dateTaken: string | null;
  deviceModel: string | null;
  deviceBrand: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;

  // JFIF / RESOLUTION (IMAGEMAGICK/EXIFR)
  jfifVersion: number | null;
  resolutionUnit: number | null;
  thumbnailHeight: number | null;
  thumbnailWidth: number | null;
  xResolution: number | null;
  yResolution: number | null;

  // VIDEO / AUDIO (FFMPEG)
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  fps: number | null;
  audioSampleRate: number | null;
  audioChannels: string | null;
  creationTime: string | null;

  // APP-LEVEL (IMPORTANT)
  thumbnail: string | null;
  chunkSize: number | null;
  chunkCount: number | null;
  chunkIvs: string[] | null;

  // OPTIONAL EXTENSIONS
  hash: string | null;
}
