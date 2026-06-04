/**
 * MP4 Faststart — pure ArrayBuffer implementation.
 * Moves the moov atom before mdat so browsers can stream without
 * downloading the whole file first. No ffmpeg, no WebCodecs, no WASM.
 * Works on all browsers including iOS Safari and Android Chrome.
 */

interface Mp4Box {
  type: string;
  offset: number;
  size: number;
}

const BOX_HEADER_BYTES = 16;
const MAX_PATCHED_MOOV_BYTES = 128 * 1024 * 1024; // 128 MB — moov should never be this big
const FASTSTART_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 10_000;

// ─── FileReader wrapper ───────────────────────────────────────────────────────

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

// ─── Box Parser ───────────────────────────────────────────────────────────────

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
      const hi = view.getUint32(8);
      const lo = view.getUint32(12);
      size = hi * 0x1_0000_0000 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = file.size - offset;
    }

    if (size < headerSize || offset + size > file.size) break;

    boxes.push({ type, offset, size });
    offset += size;
  }

  return boxes;
}

// ─── Offset Patcher ───────────────────────────────────────────────────────────

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
      const count = view.getUint32(i + 12);
      for (let e = 0; e < count; e++) {
        const pos = i + 16 + e * 4;
        view.setUint32(pos, view.getUint32(pos) + delta);
      }
    } else if (type === "co64") {
      const count = view.getUint32(i + 12);
      for (let e = 0; e < count; e++) {
        const pos = i + 16 + e * 8;
        const hi = view.getUint32(pos);
        const lo = view.getUint32(pos + 4);
        const updated = hi * 0x1_0000_0000 + lo + delta;
        view.setUint32(pos, Math.floor(updated / 0x1_0000_0000));
        view.setUint32(pos + 4, updated >>> 0);
      }
    } else if (CONTAINER_BOXES.has(type)) {
      walkBoxes(data, view, i + 8, i + size, delta);
    }

    i += size;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function optimizeVideoForStreaming(file: File): Promise<File> {
  const name = file.name.toLowerCase();
  const isMp4 =
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mov");

  if (!isMp4) return file;

  const work = async (): Promise<File> => {
    try {
      const boxes = await parseTopLevelBoxes(file);

      const ftyp = boxes.find((b) => b.type === "ftyp");
      const moov = boxes.find((b) => b.type === "moov");
      const mdat = boxes.find((b) => b.type === "mdat");

      if (!moov || !mdat) {
        console.warn("[MP4 Faststart] Missing moov or mdat — skipping.");
        return file;
      }

      // Already optimized
      if (moov.offset < mdat.offset) {
        console.log("[MP4 Faststart] ✅ Already optimized — skipping rewrite.");
        return file;
      }

      if (moov.size > MAX_PATCHED_MOOV_BYTES) {
        console.warn(
          "[MP4 Faststart] moov too large to patch safely — skipping.",
        );
        return file;
      }

      // ── Delta calculation ──────────────────────────────────────────────────
      const ftypSize = ftyp?.size ?? 0;
      let actualNewMdatOffset = ftypSize + moov.size;
      for (const box of boxes) {
        if (box.type === "ftyp" || box.type === "moov") continue;
        if (box.type === "mdat") break;
        actualNewMdatOffset += box.size;
      }
      const delta = actualNewMdatOffset - mdat.offset;

      // ── Patch moov (must be in memory to rewrite chunk offsets) ───────────
      // moov is always small — metadata only, never contains frame data.
      // The 128 MB guard above ensures this is safe for any real-world file.
      const patchedMoov = new Uint8Array(
        await readSlice(file, moov.offset, moov.offset + moov.size),
      );
      patchChunkOffsets(patchedMoov, delta);

      // ── Assemble output ────────────────────────────────────────────────────
      //
      // Strategy:
      //   • moov  → already in memory as Uint8Array, use directly
      //   • ftyp  → tiny (usually ~20 bytes), eager read is fine
      //   • mdat  → can be gigabytes, NEVER load into RAM — lazy slice only
      //   • other → free/skip/uuid etc, tiny, eager read is fine
      //
      // Lazy file.slice() for mdat means the browser streams it through
      // during XHR upload without it ever sitting in memory.
      // new File([...parts]) does not consume the slices eagerly —
      // it holds blob references until something reads from the File.

      const parts: BlobPart[] = [];

      if (ftyp) {
        // Tiny box — eager read so it's a concrete buffer, not a lazy slice
        parts.push(await readSlice(file, ftyp.offset, ftyp.offset + ftyp.size));
      }

      parts.push(patchedMoov);

      for (const box of boxes) {
        if (box.type === "ftyp" || box.type === "moov") continue;

        if (box.type === "mdat") {
          // Gigabyte-scale — lazy reference only, zero RAM cost
          parts.push(file.slice(box.offset, box.offset + box.size));
        } else {
          // free / skip / wide / uuid — all tiny structural boxes
          // Eager read keeps them as concrete buffers (safer on iOS)
          parts.push(await readSlice(file, box.offset, box.offset + box.size));
        }
      }

      const optimized = new File(parts, file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });

      console.log(
        `[MP4 Faststart] ✅ Done — moov moved to front` +
          ` (${file.name}, ${(file.size / 1024 / 1024).toFixed(1)} MB)`,
      );

      return optimized;
    } catch (err) {
      console.error("[MP4 Faststart] Failed, returning original file:", err);
      return file;
    }
  };

  let settled = false;

  return Promise.race([
    work().then((result) => {
      settled = true;
      return result;
    }),
    new Promise<File>((resolve) =>
      setTimeout(() => {
        if (settled) return;
        console.warn("[MP4 Faststart] Timed out — returning original file");
        resolve(file);
      }, FASTSTART_TIMEOUT_MS),
    ),
  ]);
}
