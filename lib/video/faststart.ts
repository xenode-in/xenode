/**
 * MP4 Faststart — pure ArrayBuffer implementation.
 * Moves the moov atom before mdat so browsers can stream without
 * downloading the whole file first. No ffmpeg, no WebCodecs, no WASM.
 * Works on all browsers including iOS Safari and Android Chrome.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Mp4Box {
  type: string;
  offset: number; // byte offset in the original buffer
  size: number; // total box size including header
}

const BOX_HEADER_BYTES = 16;
const MAX_PATCHED_MOOV_BYTES = 128 * 1024 * 1024;

// ─── Box Parser ───────────────────────────────────────────────────────────────

/**
 * Read a byte range from a File into an ArrayBuffer.
 *
 * iOS Safari has a long-standing bug where `Blob.prototype.arrayBuffer()`
 * hangs (the returned Promise never settles) for sliced blobs coming from
 * the native file-picker.  We use the older, event-driven FileReader API
 * which is reliable across every browser including iOS Safari 14+.
 *
 * A per-read timeout (10 s) is included so the optimisation falls back to
 * the original file rather than hanging forever on an exotic UA.
 */
const READ_TIMEOUT_MS = 10_000;

function readSlice(
  file: File,
  start: number,
  end: number,
): Promise<ArrayBuffer> {
  const blob = file.slice(start, end);

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reader.abort();
        reject(new Error("[MP4 Faststart] File read timed out"));
      }
    }, READ_TIMEOUT_MS);

    reader.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reader.result as ArrayBuffer);
    };

    reader.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(reader.error ?? new Error("[MP4 Faststart] FileReader error"));
    };

    reader.readAsArrayBuffer(blob);
  });
}

async function parseTopLevelBoxes(file: File): Promise<Mp4Box[]> {
  const boxes: Mp4Box[] = [];
  let offset = 0;

  while (offset + 8 <= file.size) {
    const headerBuffer = await readSlice(
      file,
      offset,
      Math.min(offset + BOX_HEADER_BYTES, file.size),
    );
    const view = new DataView(headerBuffer);
    const bytes = new Uint8Array(headerBuffer);
    let size = view.getUint32(0);
    let headerSize = 8;
    const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);

    if (size === 1) {
      if (headerBuffer.byteLength < 16) break;
      // 64-bit extended size sits right after the type field
      const hi = view.getUint32(8);
      const lo = view.getUint32(12);
      size = hi * 0x1_0000_0000 + lo;
      headerSize = 16;
    } else if (size === 0) {
      // size=0 means "box extends to EOF"
      size = file.size - offset;
    }

    if (size < headerSize || offset + size > file.size) break;

    boxes.push({
      type,
      offset,
      size,
    });

    offset += size;
  }

  return boxes;
}

// ─── Offset Patcher ───────────────────────────────────────────────────────────

/**
 * Recursively walks a moov box copy and adds `delta` to every
 * stco (32-bit) and co64 (64-bit) chunk-offset entry.
 *
 * These entries are absolute file offsets pointing into mdat.
 * When we slide mdat forward by `delta` bytes we must update them.
 */
function patchChunkOffsets(moovCopy: Uint8Array, delta: number): void {
  const view = new DataView(
    moovCopy.buffer,
    moovCopy.byteOffset,
    moovCopy.byteLength,
  );
  walkBoxes(moovCopy, view, 0, moovCopy.length, delta);
}

const CONTAINER_BOXES = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "udta",
]);

function walkBoxes(
  data: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  delta: number,
): void {
  let i = start;

  while (i + 8 <= end) {
    let size = view.getUint32(i);
    const type = String.fromCharCode(
      data[i + 4],
      data[i + 5],
      data[i + 6],
      data[i + 7],
    );

    if (size === 0) size = end - i;
    if (size < 8) break;

    if (type === "stco") {
      // Full box: version(1) + flags(3) + entry_count(4) + entries(4 each)
      const count = view.getUint32(i + 12);
      for (let e = 0; e < count; e++) {
        const pos = i + 16 + e * 4;
        view.setUint32(pos, view.getUint32(pos) + delta);
      }
    } else if (type === "co64") {
      // Full box: version(1) + flags(3) + entry_count(4) + entries(8 each)
      const count = view.getUint32(i + 12);
      for (let e = 0; e < count; e++) {
        const pos = i + 16 + e * 8;
        const hi = view.getUint32(pos);
        const lo = view.getUint32(pos + 4);
        // JS numbers lose precision above 2^53, but video files are
        // unlikely to have chunk offsets >2^52 (~4 petabytes).
        const updated = hi * 0x1_0000_0000 + lo + delta;
        view.setUint32(pos, Math.floor(updated / 0x1_0000_0000));
        view.setUint32(pos + 4, updated >>> 0);
      }
    } else if (CONTAINER_BOXES.has(type)) {
      // Recurse into container boxes (skip their 8-byte header)
      walkBoxes(data, view, i + 8, i + size, delta);
    }

    i += size;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Optimizes an MP4 file for progressive streaming by moving the moov atom
 * to the front of the file (equivalent to `ffmpeg -movflags +faststart`).
 *
 * - Zero dependencies, zero WASM, zero re-encoding
 * - Works on all browsers (iOS Safari, Android Chrome, desktop)
 * - Returns the original File unchanged if:
 *     • the file is not an MP4 / MOV
 *     • moov is already before mdat (already optimized)
 *     • any parse error occurs
 */
export async function optimizeVideoForStreaming(file: File): Promise<File> {
  // iOS Safari's File/Blob APIs are unreliable (reads hang, memory issues).
  // Apple's camera already writes moov-before-mdat, so skip entirely on iOS.

  // Detects any browser on iOS (Safari, Chrome, Firefox, Edge — all use WebKit)
  const isIOS =
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)); // iPadOS 13+

  if (isIOS) return file;

  const name = file.name.toLowerCase();
  const isMp4 =
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mov");

  if (!isMp4) return file;

  try {
    const boxes = await parseTopLevelBoxes(file);

    const ftyp = boxes.find((b) => b.type === "ftyp");
    const moov = boxes.find((b) => b.type === "moov");
    const mdat = boxes.find((b) => b.type === "mdat");

    if (!moov || !mdat) {
      console.warn("[MP4 Faststart] Missing moov or mdat box — skipping.");
      return file;
    }

    // Already optimized — moov is before mdat
    if (moov.offset < mdat.offset) return file;

    if (moov.size > MAX_PATCHED_MOOV_BYTES) {
      console.warn("[MP4 Faststart] moov box is too large to patch safely.");
      return file;
    }

    // ── Calculate the offset delta ──────────────────────────────────────────
    //
    // New layout:  [ftyp?] [moov] [everything-else (mdat + any free boxes)]
    //
    // mdat's new start = size-of-ftyp + size-of-moov
    // delta = new_mdat_start − old_mdat_start
    //
    // (delta is typically positive; moov moves forward, mdat shifts forward)

    const ftypSize = ftyp?.size ?? 0;
    let actualNewMdatOffset = ftypSize + moov.size;
    for (const box of boxes) {
      if (box.type === "ftyp" || box.type === "moov") continue;
      if (box.type === "mdat") break;
      actualNewMdatOffset += box.size;
    }
    const delta = actualNewMdatOffset - mdat.offset;

    // ── Build the patched moov ───────────────────────────────────────────────
    const patchedMoov = new Uint8Array(
      await readSlice(file, moov.offset, moov.offset + moov.size),
    );
    patchChunkOffsets(patchedMoov, delta);

    // ── Assemble output: ftyp → moov → everything else ──────────────────────
    const parts: BlobPart[] = [];

    if (ftyp) {
      parts.push(file.slice(ftyp.offset, ftyp.offset + ftyp.size));
    }

    parts.push(patchedMoov);

    for (const box of boxes) {
      if (box.type === "ftyp" || box.type === "moov") continue;
      parts.push(file.slice(box.offset, box.offset + box.size));
    }

    return new File(parts, file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.error("[MP4 Faststart] Failed, returning original file:", err);
    return file;
  }
}
