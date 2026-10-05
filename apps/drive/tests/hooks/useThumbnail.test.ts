import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __thumbnailBatchTestUtils,
  __thumbnailDecodeTestUtils,
} from "@/hooks/useThumbnail";
import { encryptThumbnail } from "@/lib/crypto/fileEncryption";
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
  it("renders only a thumbnail sealed for this file, never plaintext", async () => {
    vi.restoreAllMocks(); // data: URLs go through the real fetch
    expect(__thumbnailDecodeTestUtils).toBeDefined();
    const decode = __thumbnailDecodeTestUtils!.decodeDownloadedThumbnail;
    const bytes = (text: string) => new TextEncoder().encode(text).slice().buffer as ArrayBuffer;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const sealed = await encryptThumbnail("data:image/png;base64,iVBORw0KGgo=", key, "65f0000000000000000000aa");

    await expect(decode(bytes(sealed), null, "65f0000000000000000000aa")).resolves.toBeNull();
    await expect(decode(bytes(sealed), key, "65f0000000000000000000bb")).resolves.toBeNull();
    // Raw image bytes or a data URL served by the server are not rendered.
    await expect(decode(bytes("\u00ff\u00d8\u00ff\u00e0 JFIF"), key, "65f0000000000000000000aa")).resolves.toBeNull();
    await expect(decode(bytes("data:image/png;base64,iVBORw0KGgo="), key, "65f0000000000000000000aa")).resolves.toBeNull();
    const opened = await decode(bytes(sealed), key, "65f0000000000000000000aa");
    expect(opened?.type).toBe("image/png");
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
