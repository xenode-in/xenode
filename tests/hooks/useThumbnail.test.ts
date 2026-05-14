import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __thumbnailBatchTestUtils } from "@/hooks/useThumbnail";

const batchUtils = __thumbnailBatchTestUtils;

describe("useThumbnail batcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    batchUtils?.resetThumbnailBatcherForTests();
  });

  afterEach(() => {
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
