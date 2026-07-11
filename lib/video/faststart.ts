/**
 * MP4 Faststart — production-ready pure ArrayBuffer implementation.
 *
 * Moves the moov atom before mdat so browsers can begin playback without
 * downloading the whole file first (equivalent to `ffmpeg -movflags +faststart`).
 *
 * Design goals:
 *   ✅ Zero dependencies — no ffmpeg, no WebCodecs, no WASM
 *   ✅ Any file size — mdat is never loaded into RAM (lazy blob reference)
 *   ✅ All browsers — iOS Safari, iOS Chrome, Android Chrome, desktop
 *   ✅ All real-world MP4 layouts — moov-first, moov-last, fMP4, multi-mdat
 *   ✅ E2EE safe — operates on the original File before encryption
 *   ✅ Always returns a valid File — original returned on any failure/timeout
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Mp4Box {
  /** Four-character box type, e.g. "ftyp", "moov", "mdat" */
  type: string;
  /** Absolute byte offset of this box in the source file */
  offset: number;
  /** Total byte length of this box including its header */
  size: number;
}

export type FaststartResult =
  | { status: "optimized"; file: File }
  | { status: "already_optimized"; file: File }
  | { status: "fragmented"; file: File }
  | { status: "skipped"; file: File; reason: string }
  | { status: "failed"; file: File; error: unknown }
  | { status: "timeout"; file: File };

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum moov size we will load into RAM and patch.
 * Real-world moov boxes are 100 KB – 2 MB.
 * 128 MB is a very generous ceiling that protects against malformed files.
 */
const MAX_MOOV_BYTES = 128 * 1024 * 1024;

/**
 * Total wall-clock budget for the entire faststart operation.
 * If anything hangs (FileReader, iOS WKWebView quirks, etc.) the original
 * file is returned rather than blocking the upload indefinitely.
 */
const FASTSTART_TIMEOUT_MS = 30_000;

/**
 * Per-slice FileReader timeout.
 * Each individual read of a box header or small structural box must complete
 * within this window.
 */
const READ_TIMEOUT_MS = 10_000;

/**
 * How many bytes to read when probing a box header.
 * Standard header  = 8 bytes (size + type).
 * Extended header  = 16 bytes (size=1 sentinel + type + 64-bit real size).
 */
const BOX_HEADER_PROBE = 16;

// ─── Logging ──────────────────────────────────────────────────────────────────

const TAG = "[MP4 Faststart]";
const log = (msg: string, ...a: unknown[]) =>
  console.log(`${TAG} ${msg}`, ...a);
const warn = (msg: string, ...a: unknown[]) =>
  console.warn(`${TAG} ${msg}`, ...a);
const err = (msg: string, ...a: unknown[]) =>
  console.error(`${TAG} ${msg}`, ...a);

// ─── FileReader wrapper ───────────────────────────────────────────────────────

/**
 * Read a byte range from a File into an ArrayBuffer.
 *
 * Uses the event-driven FileReader API rather than Blob.arrayBuffer() because
 * iOS Safari / WKWebView has a long-standing bug where arrayBuffer() on a
 * sliced Blob from the native file picker never settles.
 *
 * Each call is guarded by READ_TIMEOUT_MS so a single stalled read cannot
 * block the entire pipeline.
 */
function readSlice(
  file: File,
  start: number,
  end: number,
): Promise<ArrayBuffer> {
  if (start >= end) return Promise.resolve(new ArrayBuffer(0));

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reader.abort();
      reject(
        new Error(
          `readSlice(${start}..${end}) timed out after ${READ_TIMEOUT_MS} ms`,
        ),
      );
    }, READ_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    reader.onload = () => settle(() => resolve(reader.result as ArrayBuffer));
    reader.onerror = () =>
      settle(() => reject(reader.error ?? new Error("FileReader error")));
    reader.onabort = () =>
      settle(() => reject(new Error("FileReader aborted")));

    reader.readAsArrayBuffer(file.slice(start, end));
  });
}

// ─── Box Parser ───────────────────────────────────────────────────────────────

/**
 * Parse the flat list of top-level boxes in an MP4/MOV file.
 *
 * Reads only the 8–16 byte header of each box — never the payload —
 * so this is O(number_of_top_level_boxes) small reads regardless of file size.
 *
 * Handles:
 *   - Standard 32-bit box sizes
 *   - Extended 64-bit box sizes (size field = 1)
 *   - size=0 sentinel (box extends to EOF)
 *   - Truncated or malformed headers (stops cleanly)
 */
async function parseTopLevelBoxes(file: File): Promise<Mp4Box[]> {
  const boxes: Mp4Box[] = [];
  let offset = 0;

  while (offset + 8 <= file.size) {
    const probeEnd = Math.min(offset + BOX_HEADER_PROBE, file.size);
    const headerBuf = await readSlice(file, offset, probeEnd);
    const view = new DataView(headerBuf);
    const bytes = new Uint8Array(headerBuf);

    let size = view.getUint32(0);
    let headerSize = 8;
    const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);

    if (size === 1) {
      // Extended 64-bit size
      if (headerBuf.byteLength < 16) {
        warn(
          `Truncated extended-size header at offset ${offset} — stopping parse`,
        );
        break;
      }
      const hi = view.getUint32(8);
      const lo = view.getUint32(12);
      size = hi * 0x1_0000_0000 + lo; // safe up to 2^53 (~8 PB)
      headerSize = 16;
    } else if (size === 0) {
      // size=0 means "this box extends to end of file"
      size = file.size - offset;
    }

    if (size < headerSize) {
      warn(
        `Box "${type}" at offset ${offset} has invalid size ${size} — stopping parse`,
      );
      break;
    }
    if (offset + size > file.size) {
      warn(
        `Box "${type}" at offset ${offset} would extend past EOF — stopping parse`,
      );
      break;
    }

    boxes.push({ type, offset, size });
    offset += size;
  }

  return boxes;
}

// ─── fMP4 Detection ───────────────────────────────────────────────────────────

/**
 * Fragmented MP4 files use a different structure:
 *   [ftyp] [moov — init segment only] [moof + mdat pairs ...]
 *
 * They are inherently streamable and must NOT be rewritten. The moov in an
 * fMP4 does not contain stco/co64 chunk offsets (those live in each moof).
 * Patching them would produce a corrupt file.
 *
 * Presence of any top-level "moof" box is the canonical fMP4 signal.
 */
function isFragmentedMp4(boxes: Mp4Box[]): boolean {
  return boxes.some((b) => b.type === "moof");
}

// ─── Offset Patcher ───────────────────────────────────────────────────────────

/**
 * Recursively walk a moov copy and add `delta` to every
 * stco (32-bit) and co64 (64-bit) chunk-offset table entry.
 *
 * These entries are absolute byte offsets pointing into mdat.
 * When mdat moves forward by `delta` bytes every entry must increase by delta.
 */
function patchChunkOffsets(moovBytes: Uint8Array, delta: number): void {
  if (delta === 0) return;
  const view = new DataView(
    moovBytes.buffer,
    moovBytes.byteOffset,
    moovBytes.byteLength,
  );
  walkAndPatch(moovBytes, view, 0, moovBytes.byteLength, delta);
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
  "meta",
  "ilst",
]);

function walkAndPatch(
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

    if (size === 0) size = end - i; // extends to end of container
    if (size < 8 || i + size > end) break; // malformed — stop this level

    if (type === "stco") {
      // FullBox header: version(1) + flags(3) + entry_count(4) then 4-byte entries
      const count = view.getUint32(i + 12);
      for (let e = 0; e < count; e++) {
        const pos = i + 16 + e * 4;
        if (pos + 4 > end) break;
        view.setUint32(pos, (view.getUint32(pos) + delta) >>> 0);
      }
    } else if (type === "co64") {
      // FullBox header: version(1) + flags(3) + entry_count(4) then 8-byte entries
      const count = view.getUint32(i + 12);
      for (let e = 0; e < count; e++) {
        const pos = i + 16 + e * 8;
        if (pos + 8 > end) break;
        const hi = view.getUint32(pos);
        const lo = view.getUint32(pos + 4);
        const updated = hi * 0x1_0000_0000 + lo + delta;
        view.setUint32(pos, Math.floor(updated / 0x1_0000_0000));
        view.setUint32(pos + 4, updated >>> 0);
      }
    } else if (CONTAINER_BOXES.has(type)) {
      walkAndPatch(data, view, i + 8, i + size, delta);
    }

    i += size;
  }
}

// ─── Delta Calculator ─────────────────────────────────────────────────────────

/**
 * Calculate how many bytes mdat will shift after the rewrite.
 *
 * New layout: [ftyp?] [pre-moov structural boxes?] [moov] [everything else]
 *
 * delta = newFirstMdatOffset − oldFirstMdatOffset
 */
function calculateDelta(
  boxes: Mp4Box[],
  moov: Mp4Box,
  firstMdat: Mp4Box,
  ftyp: Mp4Box | undefined,
): number {
  // Base: ftyp (if present) + moov.
  let newFirstMdatOffset = (ftyp?.size ?? 0) + moov.size;

  // Keep small structural boxes that originally appeared before the first
  // mdat (for example ftyp/free/wide padding) before moov. Never count mdat
  // itself here: in the rewritten layout moov must precede the media data.
  for (const box of boxes) {
    if (box.type === "ftyp" || box.type === "moov") continue;
    if (box.type === "mdat") continue;
    if (box.offset >= firstMdat.offset) break;
    newFirstMdatOffset += box.size;
  }

  return newFirstMdatOffset - firstMdat.offset;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Build the BlobPart array for the rewritten file.
 *
 * Memory strategy (critical for large files):
 *
 *   moov  → already in RAM as patched Uint8Array (~1–5 MB in practice)
 *   ftyp  → ~20 bytes, eagerly read into ArrayBuffer
 *   mdat  → can be gigabytes — LAZY file.slice() only, zero RAM cost
 *   other → free/skip/wide/uuid structural boxes — tiny, eager read
 *
 * new File([...parts]) does NOT consume blobs eagerly.
 * It holds references; bytes flow through only when XHR reads the File.
 * RAM usage stays flat at ≈ moov size regardless of video length or file size.
 */
async function assembleParts(
  file: File,
  boxes: Mp4Box[],
  ftyp: Mp4Box | undefined,
  moov: Mp4Box,
  firstMdat: Mp4Box,
  patchedMoov: Uint8Array,
): Promise<BlobPart[]> {
  const parts: BlobPart[] = [];
  const leadingStructuralBoxes = boxes.filter(
    (box) =>
      box.type !== "ftyp" &&
      box.type !== "moov" &&
      box.type !== "mdat" &&
      box.offset < firstMdat.offset,
  );

  // 1. ftyp — always first if present
  if (ftyp) {
    parts.push(await readSlice(file, ftyp.offset, ftyp.offset + ftyp.size));
  }

  // 2. Any non-media structural boxes that were before the first mdat in the
  //    original (e.g. "free" padding written between ftyp and mdat).
  for (const box of leadingStructuralBoxes) {
    parts.push(await readSlice(file, box.offset, box.offset + box.size));
  }

  // 3. Patched moov
  parts.push(copyToArrayBuffer(patchedMoov));

  // 4. Everything else in original order. For the common [ftyp][mdat][moov]
  //    layout, this places mdat after moov, which is the actual faststart move.
  for (const box of boxes) {
    if (box.type === "ftyp" || box.type === "moov") continue;
    if (leadingStructuralBoxes.includes(box)) continue;

    if (box.type === "mdat") {
      // Never load mdat into RAM — lazy reference, zero memory cost
      parts.push(file.slice(box.offset, box.offset + box.size));
    } else {
      // free, skip, wide, uuid — small structural boxes, eager is fine
      parts.push(await readSlice(file, box.offset, box.offset + box.size));
    }
  }

  return parts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Optimizes an MP4/MOV file for progressive streaming by ensuring moov
 * appears before mdat in the byte stream.
 *
 * Always resolves — never rejects. `result.file` is always a valid File.
 *
 * @example
 * const result = await optimizeVideoForStreaming(file);
 * const fileToUpload = result.file; // use this regardless of status
 *
 * @example with status handling
 * const result = await optimizeVideoForStreaming(file);
 * if (result.status === "optimized") {
 *   console.log("moov moved to front");
 * } else if (result.status === "failed") {
 *   console.error("faststart failed:", result.error);
 * }
 * upload(result.file);
 */
export async function optimizeVideoForStreaming(
  file: File,
): Promise<FaststartResult> {
  // ── Quick reject: not an MP4/MOV ─────────────────────────────────────────
  const nameLower = file.name.toLowerCase();
  const isMp4 =
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    nameLower.endsWith(".mp4") ||
    nameLower.endsWith(".m4v") ||
    nameLower.endsWith(".mov");

  if (!isMp4) {
    return { status: "skipped", file, reason: "not an MP4/MOV file" };
  }

  // ── Core work ─────────────────────────────────────────────────────────────
  const work = async (): Promise<FaststartResult> => {
    try {
      // 1. Parse top-level box layout (header reads only — mdat data never read)
      const boxes = await parseTopLevelBoxes(file);

      if (boxes.length === 0) {
        return {
          status: "skipped",
          file,
          reason: "could not parse any MP4 boxes",
        };
      }

      // 2. fMP4 check — must precede moov/mdat checks
      if (isFragmentedMp4(boxes)) {
        log(
          "fMP4 detected — already streamable, no rewrite needed.",
          file.name,
        );
        return { status: "fragmented", file };
      }

      // 3. Locate required boxes
      const ftyp = boxes.find((b) => b.type === "ftyp");
      const moov = boxes.find((b) => b.type === "moov");
      const mdats = boxes.filter((b) => b.type === "mdat");

      if (!moov) {
        return { status: "skipped", file, reason: "no moov box found" };
      }
      if (mdats.length === 0) {
        return { status: "skipped", file, reason: "no mdat box found" };
      }

      const firstMdat = mdats[0];

      // 4. Already optimized?
      if (moov.offset < firstMdat.offset) {
        log(
          "✅ Already optimized — moov before mdat, skipping rewrite.",
          file.name,
        );
        return { status: "already_optimized", file };
      }

      // 5. Guard against pathologically large moov
      if (moov.size > MAX_MOOV_BYTES) {
        return {
          status: "skipped",
          file,
          reason: `moov size (${(moov.size / 1024 / 1024).toFixed(0)} MB) exceeds ${MAX_MOOV_BYTES / 1024 / 1024} MB safety limit`,
        };
      }

      // 6. Calculate how far mdat shifts
      const delta = calculateDelta(boxes, moov, firstMdat, ftyp);

      log(
        `Rewriting "${file.name}"`,
        `| size: ${(file.size / 1024 / 1024).toFixed(1)} MB`,
        `| delta: ${delta > 0 ? "+" : ""}${delta} bytes`,
        `| mdat boxes: ${mdats.length}`,
      );

      // 7. Read moov into RAM and patch stco/co64 offset tables
      const patchedMoov = new Uint8Array(
        await readSlice(file, moov.offset, moov.offset + moov.size),
      );
      patchChunkOffsets(patchedMoov, delta);

      // 8. Assemble output (mdat stays as lazy blob — zero extra RAM)
      const parts = await assembleParts(
        file,
        boxes,
        ftyp,
        moov,
        firstMdat,
        patchedMoov,
      );

      const optimized = new File(parts, file.name, {
        type: file.type || "video/mp4",
        lastModified: file.lastModified,
      });

      log(
        `✅ Done — moov moved to front.`,
        `| ${(file.size / 1024 / 1024).toFixed(1)} MB →`,
        `${(optimized.size / 1024 / 1024).toFixed(1)} MB`,
      );

      return { status: "optimized", file: optimized };
    } catch (e) {
      err("Unhandled error — returning original file:", e);
      return { status: "failed", file, error: e };
    }
  };

  // ── Race against global timeout ───────────────────────────────────────────
  let workSettled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    work().then((result) => {
      workSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    }),
    new Promise<FaststartResult>((resolve) =>
      timeoutId = setTimeout(() => {
        if (workSettled) return;
        warn(
          `Timed out after ${FASTSTART_TIMEOUT_MS / 1000} s — returning original file.`,
          file.name,
        );
        resolve({ status: "timeout", file });
      }, FASTSTART_TIMEOUT_MS),
    ),
  ]);
}
