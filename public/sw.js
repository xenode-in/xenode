/**
 * public/sw.js
 *
 * Service Worker that intercepts /sw/objects/<fileId> requests and returns
 * a ReadableStream of decrypted plaintext.
 *
 * Key optimisation: a 3-chunk prefetch pipeline. While chunk N is being
 * enqueued into the response stream, chunks N+1 … N+3 are already being
 * fetched + decrypted concurrently, hiding network + crypto latency.
 */

const streamRegistry = new Map();

// ── Registry limits ───────────────────────────────────────────────────────────
// Each entry is ~60 KB for a typical 1 GB / 2 MB-chunk file (urls + ivs).
// 20 entries ≈ 1.2 MB max — safe on low-end devices.
const MAX_REGISTRATIONS = 20;

// Signed URLs expire after 1 hour (3600 s). Reject requests against
// registrations older than 55 min so the player gets a clean error
// rather than mysterious 403s mid-stream.
const REGISTRATION_TTL_MS = 55 * 60 * 1000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ── Registration ─────────────────────────────────────────────────────────────

self.addEventListener("message", async (e) => {
  if (e.data?.type === "REGISTER_STREAM") {
    const {
      fileId,
      rawDEK,
      chunkSize,
      chunkCount,
      chunkIvs,
      urls,
      contentType,
      size,
    } = e.data;

    // Evict the least-recently-accessed entry when at capacity
    if (streamRegistry.size >= MAX_REGISTRATIONS) {
      let lruKey,
        lruTime = Infinity;
      for (const [key, val] of streamRegistry) {
        if (val.lastAccessedAt < lruTime) {
          lruTime = val.lastAccessedAt;
          lruKey = key;
        }
      }
      streamRegistry.delete(lruKey);
    }

    const dek = await crypto.subtle.importKey(
      "raw",
      rawDEK,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    // Exact plaintext size = ciphertext – (16-byte GCM tag per chunk)
    const plainSize = size - chunkCount * 16;

    streamRegistry.set(fileId, {
      dek,
      chunkSize,
      chunkCount,
      chunkIvs,
      urls,
      contentType,
      plainSize,
      registeredAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    e.ports[0]?.postMessage({ success: true });
    return;
  }
});

// ── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const match = url.pathname.match(/^\/sw\/objects\/(.+)$/);
  if (!match) return;

  const fileId = match[1];
  const config = streamRegistry.get(fileId);

  if (!config) {
    e.respondWith(
      new Response("Stream session not found (SW reset). Please reload.", {
        status: 404,
      }),
    );
    return;
  }

  // Bump access time so LRU eviction keeps actively-watched files alive
  config.lastAccessedAt = Date.now();

  // Signed chunk URLs expire after 1 hour. Return 410 with a clear message
  // so the player surfaces a human-readable error instead of a silent 403.
  if (Date.now() - config.registeredAt > REGISTRATION_TTL_MS) {
    streamRegistry.delete(fileId);
    e.respondWith(
      new Response(
        "Preview session expired. Please re-open the file to continue.",
        { status: 410 },
      ),
    );
    return;
  }

  e.respondWith(buildResponse(config, e.request));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Response builder with prefetch pipeline ──────────────────────────────────

async function buildResponse(config, request) {
  const { dek, chunkSize, chunkCount, chunkIvs, urls, contentType, plainSize } =
    config;

  // ── Parse Range header ─────────────────────────────────────────────────────
  let start = 0;
  let end = plainSize - 1;
  const rangeHeader = request.headers.get("Range");

  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
    }
  }

  // Cap at 8 MB per response to avoid large memory buffering
  const MAX_BYTES = 8 * 1024 * 1024;
  end = Math.min(end, start + MAX_BYTES - 1, plainSize - 1);

  const startChunk = Math.floor(start / chunkSize);
  const endChunk = Math.floor(end / chunkSize);

  // ── Prefetch pipeline ──────────────────────────────────────────────────────
  const PREFETCH = 3;
  const inflight = new Map(); // chunkIndex → Promise<Uint8Array>

  const fetchAndDecrypt = async (i) => {
    const res = await fetch(urls[i], {
      signal: request.signal,
      priority: i < startChunk + 2 ? "high" : "auto",
    });
    if (!res.ok) throw new Error(`Failed to fetch chunk ${i}: ${res.status}`);
    const cipher = await res.arrayBuffer();
    const iv = fromB64(chunkIvs[i]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      dek,
      cipher,
    );
    return new Uint8Array(plain);
  };

  // Warm up: kick off the first N fetches immediately
  for (
    let i = startChunk;
    i < Math.min(startChunk + PREFETCH, chunkCount);
    i++
  ) {
    inflight.set(i, fetchAndDecrypt(i));
  }

  let nextServe = startChunk;

  const stream = new ReadableStream(
    {
      async pull(controller) {
        if (nextServe > endChunk) {
          controller.close();

          // Speculatively prefetch the next chunk beyond the range for future
          // range requests — fire-and-forget
          const nextBeyond = endChunk + 1;
          if (nextBeyond < chunkCount && !inflight.has(nextBeyond)) {
            fetch(urls[nextBeyond]).catch(() => {});
          }
          return;
        }

        const i = nextServe++;

        // Kick off the next prefetch ahead of the playhead
        const ahead = i + PREFETCH;
        if (ahead <= endChunk && ahead < chunkCount && !inflight.has(ahead)) {
          inflight.set(ahead, fetchAndDecrypt(ahead));
        }

        try {
          let chunk = await inflight.get(i);
          inflight.delete(i);

          // Slice boundary chunks to honour the byte range
          const chunkStartOffset = i * chunkSize;
          let sliceStart = 0;
          let sliceEnd = chunk.length;

          if (i === startChunk) {
            sliceStart = Math.max(0, start - chunkStartOffset);
          }
          if (i === endChunk) {
            sliceEnd = Math.min(chunk.length, end - chunkStartOffset + 1);
          }
          if (sliceStart > 0 || sliceEnd < chunk.length) {
            chunk = chunk.slice(sliceStart, sliceEnd);
          }

          controller.enqueue(chunk);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        inflight.clear();
      },
    },
    new CountQueuingStrategy({ highWaterMark: 2 }),
  );

  // ── Build response ─────────────────────────────────────────────────────────
  const isPartial = !!rangeHeader;
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "no-store",
  });

  if (isPartial) {
    headers.set("Content-Range", `bytes ${start}-${end}/${plainSize}`);
  }

  return new Response(stream, { status: isPartial ? 206 : 200, headers });
}
