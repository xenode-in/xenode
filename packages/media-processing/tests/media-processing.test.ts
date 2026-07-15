import { describe, expect, it } from "vitest";
import {
  needsFastStart,
  planEncryptedChunks,
  readTopLevelMp4Boxes,
  requirePhotoMedia,
} from "../src";

function box(type: string, payload = new Uint8Array()): Uint8Array {
  const result = new Uint8Array(8 + payload.length);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(payload, 8);
  return result;
}

describe("media processing contracts", () => {
  it("plans deterministic encrypted chunks", () => {
    expect(planEncryptedChunks(2_500_000, 1_000_000)).toEqual({
      chunkSize: 1_000_000,
      chunkCount: 3,
    });
  });

  it("detects MP4 files requiring fast-start relocation", () => {
    const bytes = new Uint8Array([...box("mdat"), ...box("moov")]);
    expect(needsFastStart(readTopLevelMp4Boxes(bytes))).toBe(true);
  });

  it("enforces the Photos upload policy", () => {
    expect(requirePhotoMedia("image/webp")).toBe("image");
    expect(requirePhotoMedia("video/mp4")).toBe("video");
    expect(() => requirePhotoMedia("application/pdf")).toThrow("only");
  });
});
