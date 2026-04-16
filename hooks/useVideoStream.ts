/**
 * hooks/useVideoStream.ts
 *
 * MSE fallback for encrypted chunked video/audio streaming.
 * Used when the Service Worker isn't available (e.g. Safari, SW disabled).
 *
 * Implements the same 3-chunk prefetch pipeline as the SW: while chunk N
 * is being appended to the SourceBuffer, chunks N+1…N+3 are already
 * being fetched and decrypted concurrently.
 */

import { useEffect, useRef, useState } from "react";
import { decryptChunk } from "@/lib/crypto/fileEncryption";
import { MP4BoxPlayer } from "@/lib/video/mp4box";

export interface VideoStreamOptions {
  urls: string[];
  dek: CryptoKey | null;
  chunkSize: number;
  chunkCount: number;
  chunkIvs: string[];
  contentType: string;
}

export interface VideoStreamState {
  blobUrl: string | null;
  error: string | null;
  isBuffering: boolean;
  /** 0–100 — tracks how many chunks have been fetched + decrypted */
  progress: number;
}

const PREFETCH = 3;

const MIME_CODEC_MAP: Record<string, string> = {
  "video/mp4": 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  "video/webm": 'video/webm; codecs="vp9, opus"',
};

export function useVideoStream(
  opts: VideoStreamOptions | null,
  videoElement: HTMLMediaElement | null,
): VideoStreamState {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [progress, setProgress] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opts || !videoElement) return;

    // Abort any previous stream session
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setBlobUrl(null);
    setError(null);
    setIsBuffering(true);
    setProgress(0);

    const { urls, dek, chunkCount, chunkIvs, contentType } = opts;

    // ── Determine MSE codec ────────────────────────────────────────────────
    const mimeCodec = MIME_CODEC_MAP[contentType] ?? contentType;
    const mseSupported =
      typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mimeCodec);

    if (!mseSupported) {
      // MSE not available → fall back to full download + blob URL
      fullDecryptFallback(opts, abort.signal, setProgress)
        .then((url) => {
          if (!abort.signal.aborted) {
            blobUrlRef.current = url;
            setBlobUrl(url);
            setIsBuffering(false);
          }
        })
        .catch((err) => {
          if (!abort.signal.aborted && err.name !== "AbortError") {
            setError(err.message ?? "Stream failed");
            setIsBuffering(false);
          }
        });
      return () => cleanup(abort, blobUrlRef);
    }

    // ── MSE path with prefetch pipeline ────────────────────────────────────
    (async () => {
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      blobUrlRef.current = url;
      setBlobUrl(url);
      videoElement.src = url;

      // Wait for sourceopen
      await new Promise<void>((r) =>
        ms.addEventListener("sourceopen", () => r(), { once: true }),
      );
      if (abort.signal.aborted) return;

      const sb = ms.addSourceBuffer(mimeCodec);

      // Helper: wait for SourceBuffer to finish updating
      const waitForUpdate = () =>
        new Promise<void>((r) =>
          sb.addEventListener("updateend", () => r(), { once: true }),
        );

      // ── Prefetch pipeline ──────────────────────────────────────────────
      const inflight = new Map<number, Promise<ArrayBuffer>>();

      const fetchAndDecrypt = async (i: number): Promise<ArrayBuffer> => {
        const res = await fetch(urls[i], { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cipher = await res.arrayBuffer();
        return dek ? await decryptChunk(cipher, dek, chunkIvs[i]) : cipher;
      };

      // Warm up pipeline
      for (let i = 0; i < Math.min(PREFETCH, chunkCount); i++) {
        inflight.set(i, fetchAndDecrypt(i));
      }

      for (let i = 0; i < chunkCount; i++) {
        if (abort.signal.aborted) return;

        // Kick off next prefetch
        const ahead = i + PREFETCH;
        if (ahead < chunkCount && !inflight.has(ahead)) {
          inflight.set(ahead, fetchAndDecrypt(ahead));
        }

        const plainChunk = await inflight.get(i)!;
        inflight.delete(i);

        if (abort.signal.aborted) return;

        // First chunk ready → stop showing the loading spinner
        if (i === 0) setIsBuffering(false);

        // Update progress
        setProgress(Math.round(((i + 1) / chunkCount) * 100));

        // Wait for any pending update then append
        if (sb.updating) await waitForUpdate();
        sb.appendBuffer(plainChunk);
        await waitForUpdate();
      }

      if (!abort.signal.aborted && ms.readyState === "open") {
        ms.endOfStream();
      }
    })().catch((err) => {
      if (!abort.signal.aborted && err.name !== "AbortError") {
        setError(err.message ?? "Stream failed");
      }
      setIsBuffering(false);
    });

    return () => cleanup(abort, blobUrlRef);
  }, [opts, videoElement]);

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
  const { urls, dek, chunkCount, chunkIvs, contentType } = opts;

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
      plaintextChunks[i] = dek
        ? await decryptChunk(cipher, dek, chunkIvs[i])
        : cipher;
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
