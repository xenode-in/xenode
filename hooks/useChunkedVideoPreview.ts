/**
 * hooks/useChunkedVideoPreview.ts
 *
 * Downloads + decrypts a chunked AES-GCM encrypted video/audio file,
 * returning a regular blob: URL that any player (e.g. Plyr) can consume.
 *
 * Why not MediaSource Extensions (MSE):
 *   MSE requires fragmented MP4 (fMP4). User-uploaded files are typically
 *   plain MP4, so feeding raw byte-slices to a SourceBuffer fails.
 *
 * What this hook does:
 *   1. Fetches the full encrypted ciphertext with progress (0 → 50%).
 *   2. Decrypts each AES-GCM chunk using its per-chunk IV (50 → 100%).
 *   3. Returns a regular blob: URL — Plyr / native video handle it natively.
 */

import { useEffect, useRef, useState } from "react";
import { decryptChunk } from "@/lib/crypto/fileEncryption";

export interface ChunkedStreamOptions {
  streamUrl: string;
  dek: CryptoKey;
  chunkSize: number;
  chunkCount: number;
  chunkIvs: string[];
  contentType: string;
}

export interface ChunkedStreamState {
  /** Regular blob: URL once ready, null while loading */
  blobUrl: string | null;
  /** 0–100: 0-50 = download, 50-100 = decrypt */
  progress: number;
  isDecrypting: boolean;
  error: string | null;
}

export function useChunkedVideoPreview(
  opts: ChunkedStreamOptions | null,
): ChunkedStreamState {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opts) return;

    const { streamUrl, dek, chunkSize, chunkCount, chunkIvs, contentType } =
      opts;

    setBlobUrl(null);
    setProgress(0);
    setIsDecrypting(false);
    setError(null);

    const abort = new AbortController();
    let isActive = true;

    async function load() {
      try {
        // ── Phase 1: Download (0 → 50%) ──────────────────────────────────────
        const res = await fetch(streamUrl, { signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const contentLength = +(res.headers.get("Content-Length") ?? 0);
        const reader = res.body.getReader();
        const rawChunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawChunks.push(value);
          received += value.byteLength;
          if (contentLength > 0)
            setProgress(Math.round((received / contentLength) * 50));
        }

        if (!isActive) return;

        // Reassemble into one contiguous buffer
        const combined = new Uint8Array(received);
        let offset = 0;
        for (const c of rawChunks) {
          combined.set(c, offset);
          offset += c.byteLength;
        }

        // ── Phase 2: Decrypt (50 → 100%) ─────────────────────────────────────
        setIsDecrypting(true);
        const cipherChunkSize = chunkSize + 16; // +16 = GCM auth tag
        const plainParts: ArrayBuffer[] = [];

        for (let i = 0; i < chunkCount; i++) {
          if (!isActive) return;
          const slice = combined.slice(
            i * cipherChunkSize,
            i * cipherChunkSize + cipherChunkSize,
          );
          const buf = slice.buffer.slice(
            slice.byteOffset,
            slice.byteOffset + slice.byteLength,
          ) as ArrayBuffer;
          plainParts.push(await decryptChunk(buf, dek, chunkIvs[i]));
          setProgress(50 + Math.round(((i + 1) / chunkCount) * 50));
        }

        if (!isActive) return;

        // ── Phase 3: Expose blob URL ──────────────────────────────────────────
        const url = URL.createObjectURL(
          new Blob(plainParts, { type: contentType }),
        );
        blobUrlRef.current = url;
        setBlobUrl(url);
        setIsDecrypting(false);
      } catch (e: unknown) {
        if (!isActive || (e instanceof Error && e.name === "AbortError"))
          return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setIsDecrypting(false);
      }
    }

    load();

    return () => {
      isActive = false;
      abort.abort();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.streamUrl]);

  return { blobUrl, progress, isDecrypting, error };
}
