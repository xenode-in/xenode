import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { isCrossOriginProductRequest } from "@xenode/identity-core";
afterEach(() => vi.unstubAllEnvs());
describe("Photos browser API origin gate", () => {
  it("refuses simple same-site posts from hostile runtimes and other products", () => {
    vi.stubEnv("PHOTOS_ORIGIN", "https://photos.origin.test");
    for (const origin of [
      "https://edit.origin.test",
      "https://accounts.origin.test",
      "null",
      "https://outside.test",
    ]) {
      const request = new NextRequest(
        "https://photos.origin.test/api/photos/assets/trash",
        {
          method: "POST",
          headers: {
            origin,
            "sec-fetch-site": "same-site",
            "content-type": "text/plain",
          },
          body: '{"assetIds":["asset"]}',
        },
      );
      expect(proxy(request).status).toBe(403);
    }
  });
  it("allows exact-origin browser traffic and headerless server/native requests to reach authentication", () => {
    vi.stubEnv("PHOTOS_ORIGIN", "https://photos.origin.test");
    expect(
      proxy(
        new NextRequest("https://photos.origin.test/api/photos/albums", {
          method: "POST",
          headers: {
            origin: "https://photos.origin.test",
            "sec-fetch-site": "same-origin",
          },
        }),
      ).status,
    ).toBe(200);
    expect(
      proxy(
        new NextRequest(
          "https://photos.origin.test/api/cron/purge-photo-trash",
          { headers: { authorization: "Bearer synthetic-cron" } },
        ),
      ).status,
    ).toBe(200);
    expect(
      isCrossOriginProductRequest(
        new Request("https://photos.origin.test/api", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
        "https://photos.origin.test",
      ),
    ).toBe(true);
  });
});
