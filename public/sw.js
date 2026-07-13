/**
 * Client-bound E2EE media range streaming.
 *
 * Ciphertext is fetched from short-lived signed URLs and decrypted in this
 * same-origin worker. Plaintext is never persisted in Cache Storage and is
 * exposed only through an unguessable, tab-bound media-session URL.
 */

const sessions = new Map();

const MAX_SESSIONS = 4;
const MAX_CACHED_CHUNKS = 8;
const PREFETCH_CHUNKS = 2;
const MAX_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_COUNT = 100_000;
const MAX_CIPHER_BYTES = 20 * 1024 * 1024 * 1024;
const IDLE_TTL_MS = 15 * 60 * 1000;
const ABSOLUTE_TTL_MS = 2 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MEDIA_PATH_PATTERN = /^\/__xenode_media__\/([A-Za-z0-9_-]{43})$/;

const MEDIA_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "application/ogg",
]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function reply(port, message) {
  try {
    port?.postMessage(message);
  } finally {
    port?.close();
  }
}

function decodeBase64(value) {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function isAllowedSignedUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")))
    );
  } catch {
    return false;
  }
}

function validateRegistration(data, clientId) {
  if (
    !data ||
    typeof data !== "object" ||
    data.type !== "REGISTER_MEDIA_SESSION" ||
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    !TOKEN_PATTERN.test(data.token) ||
    !(data.rawDEK instanceof ArrayBuffer) ||
    data.rawDEK.byteLength !== 32 ||
    !Number.isSafeInteger(data.chunkSize) ||
    data.chunkSize <= 0 ||
    data.chunkSize > MAX_CHUNK_BYTES ||
    !Number.isSafeInteger(data.chunkCount) ||
    data.chunkCount <= 0 ||
    data.chunkCount > MAX_CHUNK_COUNT ||
    !Number.isSafeInteger(data.cipherSize) ||
    data.cipherSize <= 16 ||
    data.cipherSize > MAX_CIPHER_BYTES ||
    !Array.isArray(data.urls) ||
    data.urls.length !== data.chunkCount ||
    !data.urls.every(isAllowedSignedUrl) ||
    !Array.isArray(data.chunkIvs) ||
    data.chunkIvs.length !== data.chunkCount ||
    !data.chunkIvs.every((value) => {
      const iv = typeof value === "string" ? decodeBase64(value) : null;
      return iv?.byteLength === 12;
    }) ||
    (data.initialCiphertext !== undefined &&
      !(data.initialCiphertext instanceof ArrayBuffer)) ||
    typeof data.contentType !== "string"
  ) {
    throw new Error("Invalid encrypted media session");
  }

  const contentType = data.contentType.split(";")[0].trim().toLowerCase();
  if (!MEDIA_TYPES.has(contentType)) {
    throw new Error("Unsupported media type");
  }

  const plainSize = data.cipherSize - data.chunkCount * 16;
  const finalChunkSize = plainSize - (data.chunkCount - 1) * data.chunkSize;
  if (
    plainSize <= 0 ||
    finalChunkSize <= 0 ||
    finalChunkSize > data.chunkSize
  ) {
    throw new Error("Inconsistent encrypted media sizes");
  }
  const firstCiphertextSize =
    (data.chunkCount === 1 ? finalChunkSize : data.chunkSize) + 16;
  if (
    data.initialCiphertext &&
    data.initialCiphertext.byteLength !== firstCiphertextSize
  ) {
    throw new Error("Seeded media chunk has an invalid size");
  }

  return { contentType, plainSize };
}

function destroySession(token) {
  const session = sessions.get(token);
  if (session) session.chunkCache.clear();
  sessions.delete(token);
}

function evictSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (
      now - session.lastAccessedAt > IDLE_TTL_MS ||
      now - session.createdAt > ABSOLUTE_TTL_MS
    ) {
      destroySession(token);
    }
  }

  while (sessions.size >= MAX_SESSIONS) {
    let oldestToken = null;
    let oldestAccess = Infinity;
    for (const [token, session] of sessions) {
      if (session.lastAccessedAt < oldestAccess) {
        oldestToken = token;
        oldestAccess = session.lastAccessedAt;
      }
    }
    if (!oldestToken) break;
    destroySession(oldestToken);
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  const port = event.ports[0];
  const clientId = event.source?.id;

  if (data?.type === "CLOSE_MEDIA_SESSION") {
    const session = sessions.get(data.token);
    if (session?.clientId === clientId) destroySession(data.token);
    return;
  }
  if (data?.type !== "REGISTER_MEDIA_SESSION") return;

  event.waitUntil(
    (async () => {
      try {
        const { contentType, plainSize } = validateRegistration(data, clientId);
        evictSessions();
        destroySession(data.token);

        const dek = await crypto.subtle.importKey(
          "raw",
          data.rawDEK,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        const now = Date.now();
        const session = {
          token: data.token,
          clientId,
          dek,
          urls: [...data.urls],
          chunkSize: data.chunkSize,
          chunkCount: data.chunkCount,
          chunkIvs: [...data.chunkIvs],
          contentType,
          plainSize,
          chunkCache: new Map(),
          createdAt: now,
          lastAccessedAt: now,
        };
        if (data.initialCiphertext) {
          const firstIv = decodeBase64(data.chunkIvs[0]);
          if (!firstIv) throw new Error("Seeded media chunk has an invalid IV");
          const firstPlaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: firstIv },
            dek,
            data.initialCiphertext,
          );
          session.chunkCache.set(
            0,
            Promise.resolve(new Uint8Array(firstPlaintext)),
          );
        }
        sessions.set(data.token, session);
        reply(port, { type: "MEDIA_SESSION_READY", token: data.token });
      } catch (error) {
        reply(port, {
          type: "MEDIA_SESSION_ERROR",
          error: error instanceof Error ? error.message : "Registration failed",
        });
      }
    })(),
  );
});

function expectedCipherChunkSize(session, index) {
  if (index < session.chunkCount - 1) return session.chunkSize + 16;
  return session.plainSize - (session.chunkCount - 1) * session.chunkSize + 16;
}

function getOrFetchChunk(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) {
    return Promise.reject(new Error("Encrypted media chunk is out of bounds"));
  }

  if (session.chunkCache.has(index)) {
    const cached = session.chunkCache.get(index);
    session.chunkCache.delete(index);
    session.chunkCache.set(index, cached);
    return cached;
  }

  const pending = (async () => {
    try {
      const response = await fetch(session.urls[index], {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) {
        throw new Error(
          `Media chunk ${index} returned HTTP ${response.status}`,
        );
      }

      const ciphertext = await response.arrayBuffer();
      if (ciphertext.byteLength !== expectedCipherChunkSize(session, index)) {
        throw new Error(`Media chunk ${index} has an invalid size`);
      }
      const iv = decodeBase64(session.chunkIvs[index]);
      if (!iv || iv.byteLength !== 12) {
        throw new Error(`Media chunk ${index} has an invalid IV`);
      }

      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        session.dek,
        ciphertext,
      );
      return new Uint8Array(plaintext);
    } catch (error) {
      session.chunkCache.delete(index);
      throw error;
    }
  })();

  session.chunkCache.set(index, pending);
  while (session.chunkCache.size > MAX_CACHED_CHUNKS) {
    const oldest = session.chunkCache.keys().next().value;
    session.chunkCache.delete(oldest);
  }
  return pending;
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) {
    return { start: 0, end: size - 1, partial: false };
  }
  if (rangeHeader.includes(",")) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }

  end = Math.min(end, size - 1, start + MAX_RANGE_BYTES - 1);
  return { start, end, partial: true };
}

function responseHeaders(session, range) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, private",
    "Content-Disposition": "inline",
    "Content-Length": String(range.end - range.start + 1),
    "Content-Type": session.contentType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (range.partial) {
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${session.plainSize}`,
    );
  }
  return headers;
}

async function buildResponse(session, request) {
  const range = parseRange(request.headers.get("Range"), session.plainSize);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${session.plainSize}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const headers = responseHeaders(session, range);
  const status = range.partial ? 206 : 200;
  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }

  const startChunk = Math.floor(range.start / session.chunkSize);
  const endChunk = Math.floor(range.end / session.chunkSize);
  for (
    let index = startChunk;
    index <= Math.min(endChunk, startChunk + PREFETCH_CHUNKS);
    index += 1
  ) {
    getOrFetchChunk(session, index).catch(() => {});
  }

  let nextChunk = startChunk;
  const body = new ReadableStream(
    {
      async pull(controller) {
        if (nextChunk > endChunk) {
          controller.close();
          return;
        }

        const index = nextChunk;
        nextChunk += 1;
        const prefetchIndex = index + PREFETCH_CHUNKS;
        if (prefetchIndex <= endChunk) {
          getOrFetchChunk(session, prefetchIndex).catch(() => {});
        }

        try {
          let plaintext = await getOrFetchChunk(session, index);
          const chunkOffset = index * session.chunkSize;
          const sliceStart =
            index === startChunk ? range.start - chunkOffset : 0;
          const sliceEnd =
            index === endChunk
              ? Math.min(plaintext.byteLength, range.end - chunkOffset + 1)
              : plaintext.byteLength;
          if (sliceStart !== 0 || sliceEnd !== plaintext.byteLength) {
            plaintext = plaintext.slice(sliceStart, sliceEnd);
          }
          controller.enqueue(plaintext);
        } catch (error) {
          controller.error(error);
        }
      },
    },
    new CountQueuingStrategy({ highWaterMark: 1 }),
  );

  return new Response(body, { status, headers });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const match = MEDIA_PATH_PATTERN.exec(url.pathname);
  if (!match) return;

  const token = match[1];
  const session = sessions.get(token);
  const requestClientId = event.clientId || event.resultingClientId;

  if (!session) {
    event.respondWith(
      new Response("Media session not found", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
    return;
  }
  if (requestClientId !== session.clientId) {
    event.respondWith(
      new Response("Media session is not available to this client", {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
    return;
  }
  if (event.request.method !== "GET" && event.request.method !== "HEAD") {
    event.respondWith(
      new Response(null, {
        status: 405,
        headers: {
          Allow: "GET, HEAD",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
    return;
  }

  const now = Date.now();
  if (
    now - session.lastAccessedAt > IDLE_TTL_MS ||
    now - session.createdAt > ABSOLUTE_TTL_MS
  ) {
    destroySession(token);
    event.respondWith(
      new Response("Media session expired", {
        status: 410,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
    return;
  }

  session.lastAccessedAt = now;
  event.respondWith(buildResponse(session, event.request));
});
