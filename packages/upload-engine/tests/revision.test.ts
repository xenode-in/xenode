import { describe, expect, it, vi } from "vitest";
import { uploadRevisionCiphertext, RevisionUploadError } from "../src";

const sessionId = "0123456789abcdef01234567";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function input(apiFetch: typeof fetch, storageFetch: typeof fetch) {
  return { endpoint: "/api/save", baseRevision: 2, iv: "AQEBAQEBAQEBAQEB", ciphertext: new Uint8Array([1,2,3]).buffer, apiFetch, storageFetch };
}
describe("revision transport boundaries", () => {
  it("retries an uncertain completion with one manifest and one storage PUT", async () => {
    const api = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sessionId, uploadUrl: "https://storage.test/upload" }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(json({ revision: 3 }));
    const storage = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await uploadRevisionCiphertext(input(api, storage))).toEqual({ revision: 3 });
    expect(storage).toHaveBeenCalledOnce();
    expect(storage.mock.calls[0][1]).toMatchObject({ method: "PUT", credentials: "omit", headers: { "Content-Type": "application/octet-stream" } });
    expect(api.mock.calls[1][1]?.body).toBe(api.mock.calls[2][1]?.body);
    expect(JSON.parse(api.mock.calls[1][1]!.body as string)).toEqual({ operation: "complete", sessionId });
  });
  it("does not send ciphertext to an invalid signed URL", async () => {
    const api = vi.fn<typeof fetch>().mockResolvedValue(json({ sessionId, uploadUrl: "http://storage.test/upload" }));
    const storage = vi.fn<typeof fetch>();
    await expect(uploadRevisionCiphertext(input(api, storage))).rejects.toMatchObject({ code: "invalid_revision_reservation" });
    expect(storage).not.toHaveBeenCalled();
  });
  it("does not retry a revision conflict or mistake another 409 for that conflict", async () => {
    const api = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sessionId, uploadUrl: "https://storage.test/upload" }))
      .mockResolvedValueOnce(json({ code: "usage_not_initialized" }, 409));
    const storage = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(uploadRevisionCiphertext(input(api, storage))).rejects.toBeInstanceOf(RevisionUploadError);
    expect(api).toHaveBeenCalledTimes(2);
  });
});
