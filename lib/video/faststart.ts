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
  data: Uint8Array; // view into the original buffer (not a copy)
}

// ─── Box Parser ───────────────────────────────────────────────────────────────

function parseTopLevelBoxes(buffer: ArrayBuffer): Mp4Box[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const boxes: Mp4Box[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.byteLength) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (size === 1) {
      // 64-bit extended size sits right after the type field
      const hi = view.getUint32(offset + 8);
      const lo = view.getUint32(offset + 12);
      size = hi * 0x1_0000_0000 + lo;
    } else if (size === 0) {
      // size=0 means "box extends to EOF"
      size = buffer.byteLength - offset;
    }

    if (size < 8 || offset + size > buffer.byteLength) break;

    boxes.push({
      type,
      offset,
      size,
      data: new Uint8Array(buffer, offset, size),
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
 *     • the file is not an MP4
 *     • moov is already before mdat (already optimized)
 *     • any parse error occurs
 */
export async function optimizeVideoForStreaming(file: File): Promise<File> {
  const isMp4 =
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    file.name.toLowerCase().endsWith(".mp4") ||
    file.name.toLowerCase().endsWith(".m4v");

  if (!isMp4) return file;

  try {
    const buffer = await file.arrayBuffer();
    const boxes = parseTopLevelBoxes(buffer);

    const ftyp = boxes.find((b) => b.type === "ftyp");
    const moov = boxes.find((b) => b.type === "moov");
    const mdat = boxes.find((b) => b.type === "mdat");

    if (!moov || !mdat) {
      console.warn("[MP4 Faststart] Missing moov or mdat box — skipping.");
      return file;
    }

    // Already optimized — moov is before mdat
    if (moov.offset < mdat.offset) return file;

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
    const patchedMoov = moov.data.slice(0); // copies into a fresh ArrayBuffer
    patchChunkOffsets(patchedMoov, delta);

    // ── Assemble output: ftyp → moov → everything else ──────────────────────
    const totalSize = boxes.reduce((sum, b) => sum + b.size, 0);
    const output = new Uint8Array(totalSize);
    let cursor = 0;

    if (ftyp) {
      output.set(ftyp.data, cursor);
      cursor += ftyp.size;
    }

    output.set(patchedMoov, cursor);
    cursor += moov.size;

    for (const box of boxes) {
      if (box.type === "ftyp" || box.type === "moov") continue;
      output.set(box.data, cursor);
      cursor += box.size;
    }

    return new File([output.buffer], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.error("[MP4 Faststart] Failed, returning original file:", err);
    return file;
  }
}
