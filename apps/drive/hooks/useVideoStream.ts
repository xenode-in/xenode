/**
 * hooks/useVideoStream.ts
 *
 * MSE fallback for encrypted chunked video/audio streaming.
 * Used when the Service Worker isn't available (e.g. private windows, SW disabled).
 *
 * Chunks are fetched and decrypted with a small prefetch window and streamed
 * into a MediaSource (see @xenode/media-processing/mse-stream), so playback starts with the
 * first chunk. Only formats MSE cannot play at all (e.g. WAV) are downloaded
 * whole before playing.
 */

import { useEffect, useRef, useState } from "react";
import { decryptFilePart } from "@/lib/crypto/fileEncryption";
import {
  canStreamWithMse,
  prefetchingReader,
  streamToMediaSource,
  type MediaElementRef,
} from "@xenode/media-processing/mse-stream";

export interface VideoStreamOptions {
  /** The object id every chunk is bound to. */
  fileId: string;
  urls: string[];
  dek: CryptoKey;
  chunkSize: number;
  /** One IV per chunk; its length is the authenticated chunk count. */
  chunkIvs: string[];
  contentType: string;
  /** Chunk 0 already decrypted (for preview inspection); reused, not refetched. */
  firstChunk?: ArrayBuffer;
}

export interface VideoStreamState {
  blobUrl: string | null;
  error: string | null;
  isBuffering: boolean;
  /** 0–100 — tracks how many chunks have been fetched + decrypted */
  progress: number;
}

/**
 * The player only gets a media element once it has a source, so this hook
 * never waits for one: it produces the source. `mediaRef` is read lazily to
 * pace buffering against the playhead.
 */
export function useVideoStream(
  opts: VideoStreamOptions | null,
  mediaRef?: MediaElementRef,
): VideoStreamState {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [progress, setProgress] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opts) return;

    // Abort any previous stream session
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const { fileId, urls, dek, chunkIvs, contentType } = opts;
    const chunkCount = chunkIvs.length;

    const publish = (url: string) => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setBlobUrl(url);
    };

    // Formats MSE cannot play are downloaded whole, then played.
    const playFullDownload = () =>
      fullDecryptFallback(opts, abort.signal, setProgress)
        .then((url) => {
          if (abort.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          publish(url);
          setIsBuffering(false);
        })
        .catch((err) => {
          if (!abort.signal.aborted && err.name !== "AbortError") {
            setError(err.message ?? "Stream failed");
            setIsBuffering(false);
          }
        });

    // Chunk 0 gates the first frame, so it is fetched alone (or reused); the
    // reader then keeps the next chunks in flight ahead of the consumer.
    const readChunk = prefetchingReader(async (i) => {
      if (i === 0 && opts.firstChunk) return opts.firstChunk.slice(0);
      const res = await fetch(urls[i], { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const plain = await decryptFilePart(await res.arrayBuffer(), dek, chunkIvs[i], fileId, i, chunkCount);
      setProgress(Math.round(((i + 1) / chunkCount) * 100));
      return plain;
    }, chunkCount);

    const playStream = async () => {
      const ms = new MediaSource();
      publish(URL.createObjectURL(ms));
      await streamToMediaSource({
        ms,
        contentType,
        chunkCount,
        chunkSize: opts.chunkSize,
        readChunk,
        mediaRef,
        signal: abort.signal,
        onFirstData: () => setIsBuffering(false),
      });
    };

    // Reset first, then start: the MSE source URL is published synchronously
    // and must not be cleared by the reset.
    const timer = setTimeout(() => {
      setBlobUrl(null);
      setError(null);
      setIsBuffering(true);
      setProgress(0);
      if (!canStreamWithMse(contentType)) {
        void playFullDownload();
        return;
      }
      playStream().catch((err) => {
        if (abort.signal.aborted || err.name === "AbortError") return;
        console.warn("[Preview] MSE could not stream this file; downloading it", err);
        void playFullDownload();
      });
    }, 0);

    return () => {
      clearTimeout(timer);
      cleanup(abort, blobUrlRef);
    };
  }, [opts, mediaRef]);

  return { blobUrl, error, isBuffering, progress };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanup(
  abort: AbortController,
  blobUrlRef: React.MutableRefObject<string | null>,
) {
  abort.abort();
  if (blobUrlRef.current) {
    URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
  }
}

/**
 * Full-download fallback: fetches all chunks with concurrency,
 * decrypts them, and returns a blob: URL.
 */
async function fullDecryptFallback(
  opts: VideoStreamOptions,
  signal: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const { fileId, urls, dek, chunkIvs, contentType } = opts;
  const chunkCount = chunkIvs.length;

  const plaintextChunks: ArrayBuffer[] = new Array(chunkCount);
  let nextIndex = 0;
  const concurrency = 4;

  const worker = async () => {
    while (nextIndex < chunkCount) {
      const i = nextIndex++;
      if (signal.aborted) return;

      const res = await fetch(urls[i], { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cipher = await res.arrayBuffer();
      plaintextChunks[i] = await decryptFilePart(cipher, dek, chunkIvs[i], fileId, i, chunkCount);
      if (onProgress) onProgress(Math.round(((i + 1) / chunkCount) * 100));
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, chunkCount) },
    () => worker(),
  );
  await Promise.all(workers);

  return URL.createObjectURL(new Blob(plaintextChunks, { type: contentType }));
}
