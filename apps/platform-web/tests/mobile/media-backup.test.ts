/**
 * Pure-logic tests for the Expo mobile media-backup pipeline.
 *
 * These modules are deliberately native-free (no expo-file-system /
 * react-native imports), so they run in the shared Node/vitest setup here —
 * matching the existing cross-client E2EE test pattern. Native-dependent code
 * (FileHandle streaming, quick-crypto hashing, expo-media-library album
 * enumeration) is exercised on-device per docs/DEBUG_BUILDS.md.
 */
import { describe, expect, it } from "vitest";

import {
  calculateDelta,
  extractCodecInfo,
  parseTopLevelBoxes,
  patchChunkOffsets,
  type ByteReader,
  type Mp4Box,
} from "../../../../../xenode-expo/src/lib/streaming/mp4Boxes";
import { planChunks, GCM_TAG_BYTES } from "../../../../../xenode-expo/src/lib/streaming/chunkPlan";
import {
  albumSourceRef,
  deriveAlbumRefKey,
  normalizeAlbumTitle,
} from "../../../../../xenode-expo/src/lib/crypto/albumRef";

// ── MP4 fixture builders ────────────────────────────────────────────────────

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** A standard 32-bit box with a given type and raw payload bytes. */
function box(type: string, payload: number[] = []): number[] {
  const size = 8 + payload.length;
  return [...u32(size), ...ascii(type), ...payload];
}

/** A 64-bit extended-size box (size field === 1). */
function box64(type: string, payload: number[] = []): number[] {
  const size = 16 + payload.length;
  return [...u32(1), ...ascii(type), ...u32(0), ...u32(size), ...payload];
}

function bytes(...chunks: number[][]): Uint8Array {
  return new Uint8Array(chunks.flat());
}

/** Turn a Uint8Array into the positional reader parseTopLevelBoxes expects. */
function reader(buf: Uint8Array): ByteReader {
  return (offset, length) => buf.subarray(offset, offset + length);
}

describe("mp4Boxes.parseTopLevelBoxes", () => {
  it("parses standard 32-bit boxes in order", () => {
    const buf = bytes(box("ftyp", u32(0)), box("moov", ascii("xxxx")), box("mdat", [1, 2, 3]));
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(boxes[0].offset).toBe(0);
    expect(boxes[2].size).toBe(11);
  });

  it("parses 64-bit extended-size boxes", () => {
    const buf = bytes(box("ftyp"), box64("mdat", [9, 9, 9, 9]));
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.map((b) => b.type)).toEqual(["ftyp", "mdat"]);
    expect(boxes[1].size).toBe(20); // 16 header + 4 payload
  });

  it("treats size===0 as extend-to-EOF", () => {
    const payload = [1, 2, 3, 4, 5];
    const buf = bytes(box("ftyp"), [...u32(0), ...ascii("mdat"), ...payload]);
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes[1].type).toBe("mdat");
    expect(boxes[1].size).toBe(8 + payload.length);
    expect(boxes[1].offset + boxes[1].size).toBe(buf.length);
  });

  it("detects moov-before-mdat vs moov-after-mdat", () => {
    const before = bytes(box("ftyp"), box("moov"), box("mdat", [1]));
    const after = bytes(box("ftyp"), box("mdat", [1]), box("moov"));
    const bb = parseTopLevelBoxes(reader(before), before.length);
    const ab = parseTopLevelBoxes(reader(after), after.length);
    const moovB = bb.find((b) => b.type === "moov")!;
    const mdatB = bb.find((b) => b.type === "mdat")!;
    const moovA = ab.find((b) => b.type === "moov")!;
    const mdatA = ab.find((b) => b.type === "mdat")!;
    expect(moovB.offset).toBeLessThan(mdatB.offset);
    expect(moovA.offset).toBeGreaterThan(mdatA.offset);
  });

  it("handles multiple mdat boxes", () => {
    const buf = bytes(box("ftyp"), box("mdat", [1]), box("mdat", [2, 2]), box("moov"));
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.filter((b) => b.type === "mdat")).toHaveLength(2);
  });

  it("detects fragmented MP4 (moof present)", () => {
    const buf = bytes(box("ftyp"), box("moov"), box("moof"), box("mdat", [1]));
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.some((b) => b.type === "moof")).toBe(true);
  });

  it("keeps free/skip/wide/uuid structural boxes", () => {
    const buf = bytes(box("ftyp"), box("free"), box("wide"), box("mdat", [1]), box("moov"));
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.map((b) => b.type)).toContain("free");
    expect(boxes.map((b) => b.type)).toContain("wide");
  });

  it("stops cleanly on a truncated header", () => {
    const buf = bytes(box("ftyp"), [0, 0, 0]); // 3 dangling bytes
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.map((b) => b.type)).toEqual(["ftyp"]);
  });

  it("stops cleanly on a malformed size that overruns EOF", () => {
    const buf = bytes(box("ftyp"), [...u32(9999), ...ascii("mdat"), 1, 2]);
    const boxes = parseTopLevelBoxes(reader(buf), buf.length);
    expect(boxes.map((b) => b.type)).toEqual(["ftyp"]);
  });

  it("returns [] for a non-BMFF buffer", () => {
    const buf = new Uint8Array([0, 0, 0, 2, 0, 0]); // size 2 < 8 header
    expect(parseTopLevelBoxes(reader(buf), buf.length)).toEqual([]);
  });
});

describe("mp4Boxes.patchChunkOffsets", () => {
  function moovWith(childType: "stco" | "co64", entries: number[]): Uint8Array {
    // FullBox: version(1)+flags(3)=0, entry_count(4), then entries.
    const width = childType === "stco" ? 4 : 8;
    const entryBytes: number[] = [];
    for (const e of entries) {
      if (width === 4) entryBytes.push(...u32(e));
      else entryBytes.push(...u32(0), ...u32(e));
    }
    const child = box(childType, [...u32(0), ...u32(entries.length), ...entryBytes]);
    // moov → stbl → child (patch walks CONTAINER_BOXES recursively).
    const stbl = box("stbl", child);
    return bytes(box("moov", stbl));
  }

  it("adds delta to 32-bit stco entries", () => {
    const moov = moovWith("stco", [100, 200, 300]);
    patchChunkOffsets(moov, 50);
    // Re-parse the child offsets from the tail entries.
    const view = new DataView(moov.buffer);
    // Locate the last three u32 entries.
    const n = moov.length;
    expect(view.getUint32(n - 12)).toBe(150);
    expect(view.getUint32(n - 8)).toBe(250);
    expect(view.getUint32(n - 4)).toBe(350);
  });

  it("adds delta to 64-bit co64 entries", () => {
    const moov = moovWith("co64", [1000, 2000]);
    patchChunkOffsets(moov, 25);
    const view = new DataView(moov.buffer);
    const n = moov.length;
    // Two 8-byte entries at the tail.
    const lo1 = view.getUint32(n - 12);
    const lo2 = view.getUint32(n - 4);
    expect(lo1).toBe(1025);
    expect(lo2).toBe(2025);
  });

  it("delta 0 is a no-op", () => {
    const moov = moovWith("stco", [100]);
    const copy = moov.slice();
    patchChunkOffsets(moov, 0);
    expect(moov).toEqual(copy);
  });
});

describe("mp4Boxes.calculateDelta", () => {
  it("delta equals ftyp+moov size when moov moves before a trailing mdat", () => {
    const ftyp: Mp4Box = { type: "ftyp", offset: 0, size: 20 };
    const mdat: Mp4Box = { type: "mdat", offset: 20, size: 1000 };
    const moov: Mp4Box = { type: "moov", offset: 1020, size: 300 };
    const boxes = [ftyp, mdat, moov];
    // New first-mdat offset = ftyp(20) + moov(300) = 320; old = 20 → delta 300.
    expect(calculateDelta(boxes, moov, mdat, ftyp)).toBe(300);
  });
});

describe("mp4Boxes.extractCodecInfo", () => {
  // Build a minimal moov → trak → mdia → (hdlr + minf → stbl → stsd) tree.
  function track(handler: "vide" | "soun", format: string): number[] {
    const hdlr = box("hdlr", [...u32(0), ...u32(0), ...ascii(handler)]);
    // stsd FullBox: version/flags(4) + entry_count(4) + sample entry(size+fourcc…)
    const sampleEntry = box(format, [0, 0, 0, 0]);
    const stsd = box("stsd", [...u32(0), ...u32(1), ...sampleEntry]);
    const stbl = box("stbl", stsd);
    const minf = box("minf", stbl);
    const mdia = box("mdia", [...hdlr, ...minf]);
    return box("trak", mdia);
  }

  it("maps avc1 → h264 and mp4a → aac", () => {
    const moov = bytes(box("moov", [...track("vide", "avc1"), ...track("soun", "mp4a")]));
    const info = extractCodecInfo(moov, false);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(info.isFragmented).toBe(false);
  });

  it("maps hvc1 → hevc", () => {
    const moov = bytes(box("moov", track("vide", "hvc1")));
    expect(extractCodecInfo(moov, false).videoCodec).toBe("hevc");
  });

  it("passes the isFragmented flag through", () => {
    const moov = bytes(box("moov", track("vide", "avc1")));
    expect(extractCodecInfo(moov, true).isFragmented).toBe(true);
  });

  it("returns nulls when no recognizable tracks exist", () => {
    const moov = bytes(box("moov", box("udta")));
    const info = extractCodecInfo(moov, false);
    expect(info.videoCodec).toBeNull();
    expect(info.audioCodec).toBeNull();
  });
});

describe("chunkPlan.planChunks", () => {
  it("is deterministic for the same size", () => {
    const a = planChunks(123_456_789);
    const b = planChunks(123_456_789);
    expect(a).toEqual(b);
  });

  it("tiers chunk size by file size", () => {
    expect(planChunks(10 * 1024 * 1024).chunkSize).toBe(1 * 1024 * 1024); // <50MB
    expect(planChunks(100 * 1024 * 1024).chunkSize).toBe(4 * 1024 * 1024); // <200MB
    expect(planChunks(500 * 1024 * 1024).chunkSize).toBe(8 * 1024 * 1024); // >=200MB
  });

  it("totalEncryptedSize adds a GCM tag per chunk", () => {
    const p = planChunks(10 * 1024 * 1024);
    expect(p.totalEncryptedSize).toBe(10 * 1024 * 1024 + p.chunkCount * GCM_TAG_BYTES);
  });

  it("chunkCount covers the whole file", () => {
    const size = 10 * 1024 * 1024 + 7;
    const p = planChunks(size);
    expect(p.chunkCount).toBe(Math.ceil(size / p.chunkSize));
  });
});

describe("albumRef", () => {
  async function key() {
    // deriveAlbumRefKey takes raw private-key bytes; any stable buffer works.
    return deriveAlbumRefKey(new Uint8Array(64).fill(7).buffer);
  }

  it("normalizeAlbumTitle folds case/whitespace/unicode form", () => {
    expect(normalizeAlbumTitle("  My   Album ")).toBe("my album");
    expect(normalizeAlbumTitle("CAMERA")).toBe("camera");
  });

  it("is stable for the same (kind, title)", async () => {
    const k = await key();
    const a = await albumSourceRef(k, "user", "Vacation");
    const b = await albumSourceRef(k, "user", "vacation"); // normalized-equal
    expect(a).toBe(b);
  });

  it("differs when a user album title changes", async () => {
    const k = await key();
    const a = await albumSourceRef(k, "user", "Trip 2024");
    const b = await albumSourceRef(k, "user", "Trip 2025");
    expect(a).not.toBe(b);
  });

  it("ignores the title for system collections (locale convergence)", async () => {
    const k = await key();
    const a = await albumSourceRef(k, "system:camera", "Camera");
    const b = await albumSourceRef(k, "system:camera", "Kamera");
    expect(a).toBe(b);
  });

  it("distinguishes different system kinds", async () => {
    const k = await key();
    const cam = await albumSourceRef(k, "system:camera", "");
    const shots = await albumSourceRef(k, "system:screenshots", "");
    expect(cam).not.toBe(shots);
  });

  it("produces url-safe base64 (no +/= chars)", async () => {
    const k = await key();
    const ref = await albumSourceRef(k, "user", "Anything at all 123");
    expect(ref).not.toMatch(/[+/=]/);
  });
});
