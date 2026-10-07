import { describe, expect, it } from "vitest";
import { prefetchingReader } from "../src/mse-stream";

describe("prefetchingReader", () => {
  it("reads ahead only in order and serves a recent re-read without loading", async () => {
    const loads: number[] = [];
    const read = prefetchingReader(async (index) => {
      loads.push(index);
      return new Uint8Array([index]).buffer;
    }, 10, 2);

    // Chunk 0, then a jump to a trailing moov: nothing else competes.
    expect(new Uint8Array(await read(0))[0]).toBe(0);
    await read(9);
    expect(loads).toEqual([0, 9]);
    // Back to chunk 0 (kept, no load), then in order: read-ahead starts.
    expect(new Uint8Array(await read(0))[0]).toBe(0);
    await read(1);
    expect(loads).toEqual([0, 9, 1, 2, 3]);
    await read(2);
    expect(loads).toEqual([0, 9, 1, 2, 3, 4]);
  });
});
