import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererConfigSource, DISABLED_RENDERER_CONFIG } from "@/lib/file-security/client-config";

function enabled(version = 1) {
  return { version, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    renderers: { ...DISABLED_RENDERER_CONFIG.renderers, global: true, pdf: true } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe("renderer configuration resource", () => {
  it("starts disabled, emits fetched settings and shares an in-flight request", async () => {
    const response = deferred<Response>();
    const fetcher = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetcher);
    const source = createRendererConfigSource();
    expect(source.getSnapshot()).toBe(DISABLED_RENDERER_CONFIG);
    expect(source.getServerSnapshot()).toBe(DISABLED_RENDERER_CONFIG);
    const observed = vi.fn();
    const unsubscribe = source.subscribe(observed);
    const first = source.refresh();
    expect(source.refresh()).toBe(first);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/file-security/config", expect.objectContaining({
      cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal),
    }));
    response.resolve(Response.json(enabled()));
    expect((await first).renderers.pdf).toBe(true);
    expect(observed).toHaveBeenCalledOnce();
    expect(Object.isFrozen(source.getSnapshot().renderers)).toBe(true);
    unsubscribe();
    source.cancel();
    expect(observed).toHaveBeenCalledOnce();
  });

  it("ignores a late enabling response after cleanup and a newer kill response", async () => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal("fetch", fetcher);
    const source = createRendererConfigSource();
    const pending = source.refresh();
    const oldSignal = fetcher.mock.calls[0][1].signal as AbortSignal;
    source.cancel();
    expect(oldSignal.aborted).toBe(true);
    const current = source.refresh();
    fresh.resolve(Response.json({ ...enabled(2), renderers: { ...enabled(2).renderers, global: false } }));
    expect((await current).renderers.pdf).toBe(false);
    old.resolve(Response.json(enabled(1))); // Simulate a transport ignoring abort.
    expect(await pending).toBe(DISABLED_RENDERER_CONFIG);
    expect(source.getSnapshot().version).toBe(2);
    expect(source.getSnapshot().renderers.global).toBe(false);
  });

  it.each([
    null,
    { ...enabled(), version: -1 },
    { ...enabled(), expiresAt: "invalid" },
    { ...enabled(), renderers: { global: "true", pdf: true } },
    { ...enabled(), renderers: { global: true, pdf: "true" } },
  ])("fails closed on a malformed policy response: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    const source = createRendererConfigSource();
    expect(await source.refresh()).toBe(DISABLED_RENDERER_CONFIG);
    expect(source.getSnapshot()).toBe(DISABLED_RENDERER_CONFIG);
  });

  it("disables a previously enabled resource when a later refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(enabled())).mockRejectedValueOnce(new Error("offline")));
    const source = createRendererConfigSource();
    expect((await source.refresh()).renderers.pdf).toBe(true);
    expect(await source.refresh()).toBe(DISABLED_RENDERER_CONFIG);
    expect(source.getSnapshot().renderers.global).toBe(false);
  });
});
