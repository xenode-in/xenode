import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __thumbnailBatchTestUtils,
  __thumbnailDecodeTestUtils,
} from "@/hooks/useThumbnail";
import {
  clearThumbnailMemoryCache,
  getCachedThumbnail,
  getThumbnailCacheGeneration,
  onThumbnailMemoryCacheCleared,
  putCachedThumbnail,
} from "@/lib/thumbnails/memoryCache";

const batchUtils = __thumbnailBatchTestUtils;

describe("useThumbnail batcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearThumbnailMemoryCache();
    batchUtils?.resetThumbnailBatcherForTests();
  });

  afterEach(() => {
    clearThumbnailMemoryCache();
    batchUtils?.resetThumbnailBatcherForTests();
  });

  it("resolves every queued thumbnail when more than 50 keys are requested", async () => {
    expect(batchUtils).toBeDefined();

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        expect(input).toBe("/api/objects/thumbnail/batch");
        const body = JSON.parse(String(init?.body ?? "{}")) as { keys: string[] };
        const urls = Object.fromEntries(
          body.keys.map((key) => [key, `/signed/${key}`]),
        );

        return {
          ok: true,
          json: async () => ({ urls }),
        } as Response;
      });

    const keys = Array.from({ length: 120 }, (_, i) => `users/u1/thumb-${i}.jpg`);
    const promises = keys.map((key) => batchUtils!.requestUrl(key));

    await batchUtils!.flushBatch();

    await expect(Promise.all(promises)).resolves.toEqual(
      keys.map((key) => `/signed/${key}`),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

});
describe("thumbnail plaintext cache", () => {
  it("never treats encrypted bytes as an image when the key is unavailable", async () => {
    expect(__thumbnailDecodeTestUtils).toBeDefined();
    const encoded = new TextEncoder().encode("enc:not-decryptable");
    const data = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ) as ArrayBuffer;

    await expect(
      __thumbnailDecodeTestUtils!.decodeDownloadedThumbnail(data, null),
    ).resolves.toBeNull();
  });

  it("clears plaintext and rejects in-flight writes from an older generation", () => {
    const generation = getThumbnailCacheGeneration();
    const blob = new Blob(["pixels"], { type: "image/jpeg" });
    const listener = vi.fn();
    const unsubscribe = onThumbnailMemoryCacheCleared(listener);

    expect(putCachedThumbnail("u1:key:thumb", blob, generation)).toBe(true);
    expect(getCachedThumbnail("u1:key:thumb")).toBe(blob);

    clearThumbnailMemoryCache();

    expect(listener).toHaveBeenCalledOnce();
    expect(getCachedThumbnail("u1:key:thumb")).toBeNull();
    expect(putCachedThumbnail("u1:key:late", blob, generation)).toBe(false);
    unsubscribe();
  });
});
