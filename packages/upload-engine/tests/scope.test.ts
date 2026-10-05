import { describe, expect, it, vi } from "vitest";
import { createScopedUploadRequest, type UploadJournalScope } from "../src";

const scope: UploadJournalScope = { accountId: "account_one", productId: "drive", spaceId: "space_one",
  wrappedBy: "user", spaceKeyVersion: null };
describe("captured upload API scope", () => {
  it("binds explicit personal/Space routing and host credentials, overriding stale headers", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
    const controller = new AbortController();
    const request = createScopedUploadRequest({ scope, signal: controller.signal, isActive: () => true, fetch: fetcher });
    await request("/api/objects/presign-upload", { headers: { "x-xenode-space-id": "old_space" }, credentials: "omit" });
    const init = fetcher.mock.calls[0][1]!;
    expect(new Headers(init.headers).get("x-xenode-space-id")).toBe(scope.spaceId);
    expect(init.credentials).toBe("include");
    expect(init.signal).toBe(controller.signal);
  });
  it("scope changes before a paused request resumes prevent the request", async () => {
    let active = true;
    const fetcher = vi.fn<typeof fetch>();
    const request = createScopedUploadRequest({ scope, signal: new AbortController().signal, isActive: () => active,
      waitWhilePaused: async () => { active = false; }, fetch: fetcher });
    await expect(request("/api/objects/upload-status")).rejects.toThrow("context changed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("late responses after a lock are rejected", async () => {
    let active = true;
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const request = createScopedUploadRequest({ scope, signal: new AbortController().signal, isActive: () => active, fetch: fetcher });
    const response = request("/api/objects/upload-status");
    await Promise.resolve();
    active = false;
    resolve(Response.json({ filename: "must not publish" }));
    await expect(response).rejects.toThrow("context changed");
  });
  it("an aborted controller and arbitrary external API URLs cannot issue requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const request = createScopedUploadRequest({ scope, signal: controller.signal, isActive: () => true, fetch: fetcher });
    await expect(request("https://another-origin.test/api/objects/presign-upload")).rejects.toThrow("API path");
    controller.abort();
    await expect(request("/api/objects/presign-upload")).rejects.toThrow("context changed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
