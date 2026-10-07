import { fileChunkRange } from "@xenode/crypto-core";
import {
  prefetchingReader,
  streamToMediaSource,
  type MediaElementRef,
} from "@xenode/media-processing/mse-stream";
import { decryptPhotoVideoChunk } from "./photo-encryption";

export type ChunkedVideo = {
  url: string;
  objectKey: string;
  contentType: string;
  /** Stored (sealed) size of the whole object. */
  size: number;
  chunkSize: number;
  chunkIvs: string[];
};

/**
 * Plays a chunked video original through MediaSource: each chunk is read with
 * an HTTP range request and opened as it is needed, so playback starts after
 * the first chunks instead of the whole file. Signed URLs are short-lived, so
 * an expired one is replaced once through `refreshUrl`. Returns the source URL
 * for the player; `done` settles when the feed ends or fails.
 */
export function streamChunkedVideo(input: {
  video: ChunkedVideo;
  dek: CryptoKey;
  refreshUrl: () => Promise<string>;
  mediaRef: MediaElementRef;
  signal: AbortSignal;
  onFirstData: () => void;
}): { src: string; done: Promise<void> } {
  const { video, dek, signal } = input;
  const count = video.chunkIvs.length;
  let url = video.url;

  const fetchRange = (start: number, end: number) =>
    fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: "no-store", signal });

  const readChunk = prefetchingReader(async (index) => {
    const { start, end } = fileChunkRange(video.size, index, count, video.chunkSize);
    let response = await fetchRange(start, end);
    if (response.status === 401 || response.status === 403) {
      url = await input.refreshUrl();
      response = await fetchRange(start, end);
    }
    // A server that ignores Range would send the whole file for every chunk.
    if (response.status !== 206 && !(response.ok && start === 0 && end === video.size)) {
      throw new Error(`Range read failed (${response.status})`);
    }
    return decryptPhotoVideoChunk(await response.arrayBuffer(), dek, video.objectKey, video.chunkIvs, index);
  }, count);

  const ms = new MediaSource();
  const src = URL.createObjectURL(ms);
  const done = streamToMediaSource({
    ms,
    contentType: video.contentType,
    chunkCount: count,
    chunkSize: video.chunkSize,
    readChunk,
    mediaRef: input.mediaRef,
    signal,
    onFirstData: input.onFirstData,
  });
  return { src, done };
}
