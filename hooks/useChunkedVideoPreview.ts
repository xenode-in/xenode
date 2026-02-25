/**
 * hooks/useChunkedVideoPreview.ts
 *
 * Downloads + decrypts a chunked AES-GCM encrypted video/audio file,
 * returning a regular blob: URL that Plyr can consume.
 *
 * Cache Storage strategy:
 *   MISS: fetch ciphertext → tee the ReadableStream:
 *           branch A → Cache Storage (written to disk as bytes arrive, no OOM)
 *           branch B → rolling-window decrypt loop
 *   HIT:  read from Cache Storage as ReadableStream → rolling-window decrypt
 *
 * The rolling-window decrypt loop keeps only one cipher-chunk (~1 MB +16 B)
 * in memory at a time, regardless of total file size.
 *
 * Progress:  0–50% = download / cache-read
 *            50–100% = decrypt
 */

import { useEffect, useRef, useState } from "react";
import { decryptChunk } from "@/lib/crypto/fileEncryption";
import { getCachedResponse, storeCachedStream } from "@/lib/cache/previewCache";

export interface ChunkedStreamOptions {
  streamUrl: string;
  dek: CryptoKey;
  chunkSize: number;
  chunkCount: number;
  chunkIvs: string[];
  contentType: string;
  /** Share token — Cache Storage key */
  cacheKey: string;
  /** Plaintext file size in bytes — used to enforce the cache size limit */
  fileSizeBytes: number;
}

export interface ChunkedStreamState {
  blobUrl: string | null;
  progress: number;
  isDecrypting: boolean;
  fromCache: boolean;
  error: string | null;
}

export function useChunkedVideoPreview(
  opts: ChunkedStreamOptions | null,
): ChunkedStreamState {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opts) return;

    const {
      streamUrl,
      dek,
      chunkSize,
      chunkCount,
      chunkIvs,
      contentType,
      cacheKey,
      fileSizeBytes,
    } = opts;

    setBlobUrl(null);
    setProgress(0);
    setIsDecrypting(false);
    setFromCache(false);
    setError(null);

    const abort = new AbortController();
    let isActive = true;

    async function load() {
      try {
        // ── Phase 1: Get a ReadableStream of ciphertext (cache or network) ──
        let ciphertextStream: ReadableStream<Uint8Array>;
        let contentLength = 0;

        const cachedResponse = await getCachedResponse(cacheKey);

        if (cachedResponse) {
          // Cache HIT — read from Cache Storage as a stream
          ciphertextStream = cachedResponse.body!;
          contentLength = +(cachedResponse.headers.get("content-length") ?? 0);
          setFromCache(true);
          setProgress(50); // skip download phase visually
          console.log(`[PreviewCache] Cache hit for token ${cacheKey}`);
        } else {
          // Cache MISS — fetch from B2, tee to cache simultaneously
          const res = await fetch(streamUrl, { signal: abort.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

          contentLength = +(res.headers.get("content-length") ?? 0);
          const actualCacheSize =
            contentLength > 0 ? contentLength : fileSizeBytes;

          // Tee the network stream:
          //   branch A → Cache Storage (written to disk as bytes flow in)
          //   branch B → our decrypt loop below
          const [forCache, forDecrypt] = res.body.tee();
          storeCachedStream(cacheKey, forCache, actualCacheSize).catch(
            () => {},
          ); // background, non-blocking
          ciphertextStream = forDecrypt;
        }

        // ── Phase 2: Rolling-window decrypt (streams into plainParts) ────────
        // Only one cipher-chunk worth of bytes (~1 MB) is held in `pending`
        // at a time — the rest is on disk in the cache.
        if (!isActive) return;
        setIsDecrypting(true);

        const reader = ciphertextStream.getReader();
        const cipherChunkSize = chunkSize + 16; // +16 = GCM auth tag
        const plainParts: ArrayBuffer[] = [];
        let pending = new Uint8Array(0);
        let received = 0;
        let chunkIndex = 0;

        function appendPending(incoming: Uint8Array) {
          const next = new Uint8Array(pending.byteLength + incoming.byteLength);
          next.set(pending, 0);
          next.set(incoming, pending.byteLength);
          pending = next;
        }

        async function flushChunk(bytes: Uint8Array) {
          const buf = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          plainParts.push(await decryptChunk(buf, dek, chunkIvs[chunkIndex]));
          chunkIndex++;
          // 50–100% across all chunks, or 0–100% if from cache (download skipped)
          const base = fromCache ? 0 : 50;
          const range = fromCache ? 100 : 50;
          setProgress(base + Math.round((chunkIndex / chunkCount) * range));
        }

        while (true) {
          if (!isActive) return;

          const { done, value } = await reader.read();

          if (value) {
            appendPending(value);
            received += value.byteLength;
            // Download progress (cache miss only, 0→50%)
            if (!fromCache && contentLength > 0) {
              setProgress(Math.round((received / contentLength) * 50));
            }
          }

          // Drain all complete non-final cipher-chunks from the buffer
          while (
            !isActive === false &&
            chunkIndex < chunkCount - 1 &&
            pending.byteLength >= cipherChunkSize
          ) {
            const slice = pending.slice(0, cipherChunkSize);
            pending = pending.slice(cipherChunkSize);
            await flushChunk(slice);
          }

          if (done) break;
        }

        // Flush the last (possibly smaller) chunk
        if (isActive && pending.byteLength > 0) {
          await flushChunk(pending);
        }

        if (!isActive) return;

        // ── Phase 3: Expose blob URL to Plyr ─────────────────────────────────
        const url = URL.createObjectURL(
          new Blob(plainParts, { type: contentType }),
        );
        blobUrlRef.current = url;
        setBlobUrl(url);
        setIsDecrypting(false);
        setProgress(100);
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
  }, [opts?.streamUrl, opts?.cacheKey]);

  return { blobUrl, progress, isDecrypting, fromCache, error };
}
