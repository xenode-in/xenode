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

  it("isolates organization and personal requests queued in the same window", async () => {
    expect(batchUtils).toBeDefined();

    const observed: Array<{ spaceId: string | null; keys: string[] }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const headers = new Headers(init?.headers);
        const spaceId = headers.get("x-xenode-space-id");
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          keys: string[];
        };
        observed.push({ spaceId, keys: body.keys });
        const urls = Object.fromEntries(
          body.keys.map((key) => [key, `/signed/${spaceId ?? "personal"}/${key}`]),
        );
        return {
          ok: true,
          json: async () => ({ urls }),
        } as Response;
      });

    const personalKey = "users/u1/personal-thumb.jpg";
    const organizationKey = "organizations/org-1/org-thumb.jpg";
    const personalPromise = batchUtils!.requestUrl(personalKey);
    const organizationPromise = batchUtils!.requestUrl(organizationKey, {
      "x-xenode-space-id": "space_org-1",
    });

    await batchUtils!.flushBatch();

    await expect(personalPromise).resolves.toBe(
      `/signed/personal/${personalKey}`,
    );
    await expect(organizationPromise).resolves.toBe(
      `/signed/space_org-1/${organizationKey}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observed).toEqual(
      expect.arrayContaining([
        { spaceId: null, keys: [personalKey] },
        { spaceId: "space_org-1", keys: [organizationKey] },
      ]),
    );
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
