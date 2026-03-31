/**
 * public/sw.js
 *
 * High-Throughput Service Worker with Aggressive Unbounded Prefetching.
 */

const streamRegistry = new Map();

// ── Registry & Cache Limits ──────────────────────────────────────────────────
const MAX_REGISTRATIONS = 20;
const REGISTRATION_TTL_MS = 55 * 60 * 1000;
const MAX_CACHED_CHUNKS = 30;
const PREFETCH_COUNT = 4;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ── Broadcaster ──────────────────────────────────────────────────────────────
async function broadcastProgress(fileId, progress) {
  try {
    const clientsArr = await self.clients.matchAll();
    clientsArr.forEach((client) => {
      client.postMessage({ type: "CHUNK_PROGRESS", fileId, progress });
    });
  } catch (e) {
    // Safely ignore if no clients are listening
  }
}

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

    const plainSize = size - chunkCount * 16;

    streamRegistry.set(fileId, {
      fileId, // Ensure we save the fileId for the broadcaster
      dek,
      chunkSize,
      chunkCount,
      chunkIvs,
      urls,
      contentType,
      plainSize,
      chunkCache: new Map(),
      registeredAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    e.ports[0]?.postMessage({ success: true });
    return;
  }
});

// ── Fetch Interception ───────────────────────────────────────────────────────

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const match = url.pathname.match(/^\/sw\/objects\/([^/]+)(\/.*)?$/);
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

  config.lastAccessedAt = Date.now();

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

function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Global Chunk Fetcher & Cache Manager ─────────────────────────────────────

function getOrFetchChunk(config, chunkIndex) {
  if (chunkIndex >= config.chunkCount) return Promise.reject("Out of bounds");

  if (config.chunkCache.has(chunkIndex)) {
    const promise = config.chunkCache.get(chunkIndex);
    config.chunkCache.delete(chunkIndex);
    config.chunkCache.set(chunkIndex, promise);
    return promise;
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(config.urls[chunkIndex], {
        priority: "high",
        cache: "force-cache",
      });

      if (!res.ok)
        throw new Error(`Failed to fetch chunk ${chunkIndex}: ${res.status}`);

      let cipher;

      // ⚡ Extract precise byte-level progress for the first chunk to power the UI progress bar
      if (chunkIndex === 0 && res.body) {
        const total = +(res.headers.get("Content-Length") || config.chunkSize);
        let loaded = 0;
        const reader = res.body.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;

          // Emit progress (capped at 99% until decryption finishes)
          const pct = Math.min(99, Math.round((loaded / total) * 100));
          broadcastProgress(config.fileId, pct);
        }

        // Stitch the array buffers together natively
        const combined = new Uint8Array(loaded);
        let offset = 0;
        for (const c of chunks) {
          combined.set(c, offset);
          offset += c.byteLength;
        }
        cipher = combined.buffer;
        broadcastProgress(config.fileId, 100); // 100% Downloaded
      } else {
        // For background chunks (index > 0), load silently without blocking UI thread
        cipher = await res.arrayBuffer();
      }

      const iv = fromB64(config.chunkIvs[chunkIndex]);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        config.dek,
        cipher,
      );

      return new Uint8Array(plain);
    } catch (err) {
      config.chunkCache.delete(chunkIndex);
      throw err;
    }
  })();

  config.chunkCache.set(chunkIndex, fetchPromise);

  if (config.chunkCache.size > MAX_CACHED_CHUNKS) {
    const oldestKey = config.chunkCache.keys().next().value;
    config.chunkCache.delete(oldestKey);
  }

  return fetchPromise;
}

// ── Response Builder ─────────────────────────────────────────────────────────

async function buildResponse(config, request) {
  const { chunkSize, chunkCount, plainSize } = config;

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

  const MAX_BYTES = 8 * 1024 * 1024;
  end = Math.min(end, start + MAX_BYTES - 1, plainSize - 1);

  const startChunk = Math.floor(start / chunkSize);
  const endChunk = Math.floor(end / chunkSize);

  for (
    let i = startChunk;
    i <= startChunk + PREFETCH_COUNT && i < chunkCount;
    i++
  ) {
    getOrFetchChunk(config, i).catch(() => {});
  }

  let nextServe = startChunk;

  const stream = new ReadableStream(
    {
      async pull(controller) {
        if (nextServe > endChunk) {
          controller.close();
          return;
        }

        const i = nextServe++;
        const ahead = i + PREFETCH_COUNT;
        if (ahead < chunkCount) {
          getOrFetchChunk(config, ahead).catch(() => {});
        }

        try {
          let chunk = await getOrFetchChunk(config, i);
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
      cancel() {},
    },
    new CountQueuingStrategy({ highWaterMark: 1 }),
  );

  const isPartial = !!rangeHeader;
  const headers = new Headers({
    "Content-Type": config.contentType,
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "no-store",
  });

  if (isPartial) {
    headers.set("Content-Range", `bytes ${start}-${end}/${plainSize}`);
  }

  return new Response(stream, { status: isPartial ? 206 : 200, headers });
}
