export interface ChunkPlan {
  chunkSize: number;
  chunkCount: number;
}

export function planEncryptedChunks(
  size: number,
  preferredChunkSize = 1024 * 1024,
): ChunkPlan {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid size");
  if (!Number.isSafeInteger(preferredChunkSize) || preferredChunkSize <= 0) {
    throw new Error("Invalid chunk size");
  }
  return {
    chunkSize: preferredChunkSize,
    chunkCount: Math.ceil(size / preferredChunkSize),
  };
}

export type MediaKind = "image" | "video";

export function requirePhotoMedia(contentType: string): MediaKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  throw new Error("Photos accepts only image and video media");
}

export interface Mp4Box {
  type: string;
  offset: number;
  size: number;
}

export function readTopLevelMp4Boxes(bytes: Uint8Array): Mp4Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (size < 8 || offset + size > bytes.byteLength) {
      throw new Error("Invalid MP4 box");
    }
    boxes.push({ type, offset, size });
    offset += size;
  }
  if (offset !== bytes.byteLength) throw new Error("Truncated MP4");
  return boxes;
}

export function needsFastStart(boxes: Mp4Box[]): boolean {
  const moov = boxes.findIndex((box) => box.type === "moov");
  const mdat = boxes.findIndex((box) => box.type === "mdat");
  return moov >= 0 && mdat >= 0 && moov > mdat;
}

export interface EncryptedMediaMetadata {
  takenAt?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  orientation?: number;
}

export interface MetadataProcessor {
  extract(source: Blob): Promise<EncryptedMediaMetadata>;
}
