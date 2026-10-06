import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prunePhotoCiphertextCache } from "../lib/photo-preview-cache";

// In-memory Cache Storage: enough of the API for the cache module.
const store = new Map<string, Response>();
const cache = {
  async keys() { return [...store.keys()].map((url) => new Request(`https://photos.test${url}`)); },
  async match(request: Request | string) {
    return store.get(typeof request === "string" ? request : new URL(request.url).pathname)?.clone();
  },
  async put(url: string, response: Response) {
    await response.clone().arrayBuffer();
    store.set(url, response);
  },
  async delete(request: Request | string) {
    return store.delete(typeof request === "string" ? request : new URL(request.url).pathname);
  },
};
const MB = 1024 * 1024;
function entry(name: string, bytes: number, expiresAt: number) {
  store.set(`/_xenode-photos-cache/${name}`, new Response(null, {
    headers: { "x-content-length": String(bytes), "x-expires-at": String(expiresAt) },
  }));
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal("caches", { open: async () => cache });
});
afterEach(() => vi.unstubAllGlobals());

describe("Photos ciphertext cache budget", () => {
  it("drops expired and malformed entries, then the oldest until it fits", async () => {
    const now = 1_000_000;
    entry("expired", 1 * MB, now - 1);
    entry("malformed", Number.NaN, now + 10);
    entry("oldest", 40 * MB, now + 100);
    entry("middle", 40 * MB, now + 200);
    entry("newest", 40 * MB, now + 300);
    await prunePhotoCiphertextCache(100 * MB, now);
    expect([...store.keys()].map((key) => key.split("/").at(-1))).toEqual(["middle", "newest"]);
  });

  it("prunes after a tab's first write and refuses oversized entries", async () => {
    entry("expired", 1 * MB, Date.now() - 1);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const size = url.endsWith("large") ? 65 * MB : 1024;
      return new Response(new Uint8Array(size), { headers: { "content-length": String(size) } });
    }));
    vi.resetModules(); // a fresh tab
    const fresh = await import("../lib/photo-preview-cache");
    await fresh.fetchCachedPhotoCiphertext("https://r2.test/small", "small");
    await vi.waitFor(() => {
      expect(store.has("/_xenode-photos-cache/small")).toBe(true);
      expect(store.has("/_xenode-photos-cache/expired")).toBe(false);
    });

    expect((await fresh.fetchCachedPhotoCiphertext("https://r2.test/large", "large")).byteLength).toBe(65 * MB);
    expect(store.has("/_xenode-photos-cache/large")).toBe(false);
  });
});
