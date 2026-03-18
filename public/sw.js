const streamsMap = new Map();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'REGISTER_STREAM') {
    const { fileId, rawDEK, chunkSize, chunkCount, chunkIvs, urls, contentType, size } = event.data;
    
    // Import the raw DEK into a CryptoKey for decryption
    const dek = await crypto.subtle.importKey(
      "raw",
      rawDEK,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    // Calculate exact plaintext size
    const plainSize = size - (chunkCount * 16);

    streamsMap.set(fileId, {
      dek,
      chunkSize,
      chunkCount,
      chunkIvs,
      urls,
      contentType,
      plainSize
    });
    
    // Acknowledge registration
    event.ports[0]?.postMessage({ success: true });
  }
});

// Helper to convert base64 to Uint8Array for IV
function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/^\/sw\/objects\/(.+)$/);
  
  if (match) {
    const fileId = match[1];
    event.respondWith(handleStreamRequest(event.request, fileId));
  }
});

async function handleStreamRequest(request, fileId) {
  const streamInfo = streamsMap.get(fileId);
  if (!streamInfo) {
    // If the SW was restarted, memory is lost.
    // Return 404 to prompt the client to re-initialize the stream.
    return new Response('Stream session not found (SW reset). Please reload the video.', { status: 404 });
  }

  const { dek, chunkSize, chunkCount, chunkIvs, urls, contentType, plainSize } = streamInfo;
  
  let start = 0;
  let end = plainSize - 1;
  const rangeHeader = request.headers.get('Range');
  
  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (rangeMatch) {
      start = parseInt(rangeMatch[1], 10);
      if (rangeMatch[2]) {
        end = parseInt(rangeMatch[2], 10);
      }
    }
  }

  // Max 8MB per response to avoid large memory buffering
  const MAX_BYTES = 8 * 1024 * 1024;
  end = Math.min(end, start + MAX_BYTES - 1);
  if (end >= plainSize) end = plainSize - 1;

  const startChunk = Math.floor(start / chunkSize);
  const endChunk = Math.floor(end / chunkSize);
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let i = startChunk; i <= endChunk; i++) {
          if (request.signal.aborted) {
            break;
          }
          
          // Fetch encrypted chunk
          const res = await fetch(urls[i], { signal: request.signal });
          if (!res.ok) throw new Error(`Failed to fetch chunk ${i}`);
          const cipherChunk = await res.arrayBuffer();
          
          if (request.signal.aborted) break;

          // Decrypt chunk
          const iv = fromB64(chunkIvs[i]);
          const plainChunk = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            dek,
            cipherChunk
          );
          
          if (request.signal.aborted) break;

          let chunkData = new Uint8Array(plainChunk);
          
          // Slice if it's the first or last chunk in the requested range
          const chunkStartOffset = i * chunkSize;
          const chunkEndOffset = chunkStartOffset + chunkData.length - 1;
          
          let sliceStart = 0;
          let sliceEnd = chunkData.length;
          
          if (i === startChunk) {
            sliceStart = Math.max(0, start - chunkStartOffset);
          }
          if (i === endChunk) {
            sliceEnd = Math.min(chunkData.length, (end - chunkStartOffset) + 1); // Correct length
          }
          
          if (sliceStart > 0 || sliceEnd < chunkData.length) {
            chunkData = chunkData.slice(sliceStart, sliceEnd);
          }
          
          controller.enqueue(chunkData);
        }
        
        controller.close();
        
        // Prefetch next chunk if not aborted and not at the end
        if (!request.signal.aborted && endChunk + 1 < chunkCount) {
          fetch(urls[endChunk + 1]).catch(() => {});
        }
      } catch (err) {
        if (!request.signal.aborted) {
          console.error("SW Streaming error:", err);
          controller.error(err);
        }
      }
    }
  });

  const isPartial = !!rangeHeader;
  const status = isPartial ? 206 : 200;
  
  const headers = new Headers({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': (end - start + 1).toString(),
    'Cache-Control': 'no-store'
  });

  if (isPartial) {
    headers.set('Content-Range', `bytes ${start}-${end}/${plainSize}`);
  }

  return new Response(stream, { status, headers });
}
