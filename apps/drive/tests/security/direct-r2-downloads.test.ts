import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { context } = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/authz", async original => ({ ...await original<typeof import("@/lib/authz")>(), requireAccessContext: context }));
vi.mock("@/lib/subscriptions/service", () => ({ enforceStorageAccess: vi.fn() }));
import { GET as content } from "@/app/api/objects/[id]/content/route";
import { downloadCiphertextBlob } from "@/lib/crypto/direct-download";
import { encryptFileChunks, generateFileKey } from "@xenode/crypto-core";
import { getSignedFileUrl, fileUrlLifetime } from "@/lib/b2/cdn";
import { Space } from "@xenode/database";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import ShareLink from "@/models/ShareLink";
import { POST as stream } from "@/app/api/share/[token]/stream/route";
import { POST as download } from "@/app/api/share/[token]/download/route";
import { resolveThumbnailAccess } from "@/lib/storage/shareBucket";

async function fixture(expiresAt?: Date) {
  const spaceId = "space_personal_download-owner";
  await Space.create({ _id: spaceId, type: "personal", ownerAccountId: "download-owner", createdByAccountId: "download-owner" });
  const bucket = await Bucket.create({ name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage", storageRegion: "asia" });
  const object = await StorageObject.create({ bucketId: bucket._id, spaceId, productId: "drive", createdByAccountId: "download-owner", key: "users/download-owner/0123456789abcdef0123456789abcdef", size: 40, b2FileId: "main", isEncrypted: true, iv: "sealed-iv" });
  const link = await ShareLink.create({ objectId: object._id, bucketId: bucket._id, createdBy: "download-owner", expiresAt, shareEncryptedThumbnail: "shares/thumbnail" });
  return { link, object };
}
function request() { return new NextRequest("http://localhost/share", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }); }
function args(token: string) { return { params: Promise.resolve({ token }) }; }

describe("direct ciphertext download capabilities", () => {
  it("signs the exact R2 GET with private no-store response overrides and unsigned ranges", async () => {
    const send = vi.spyOn(globalThis, "fetch");
    const url = new URL(await getSignedFileUrl("xenode-drive-storage", "users/account/key with + space"));
    expect(url.hostname).toBe("example.r2.cloudflarestorage.com");
    expect(decodeURIComponent(url.pathname)).toBe("/xenode-drive-storage/users/account/key with + space");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
    expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(send).not.toHaveBeenCalled(); send.mockRestore();
  });
  it("caps requested lifetimes and fails before signing invalid or unknown targets", async () => {
    expect(new URL(await getSignedFileUrl("xenode-drive-storage", "key", 3600)).searchParams.get("X-Amz-Expires")).toBe("300");
    await expect(getSignedFileUrl("foreign-bucket", "key")).rejects.toThrow("unknown");
    await expect(getSignedFileUrl("xenode-drive-storage", "key", 0)).rejects.toThrow("Invalid");
    await expect(getSignedFileUrl("xenode-drive-storage", "", 10)).rejects.toThrow("Invalid");
  });
  it("rounds deadlines down and refuses expired or malformed authorization", () => {
    expect(fileUrlLifetime(new Date(10_999), 1000)).toBe(9);
    expect(fileUrlLifetime(new Date(1_000_000), 0)).toBe(300);
    expect(() => fileUrlLifetime(new Date(1000), 1000)).toThrow("expired");
    expect(() => fileUrlLifetime(new Date(NaN), 0)).toThrow("expired");
  });
  it("limits every chunk to the share deadline and marks capability responses no-store", async () => {
    const { link, object } = await fixture(new Date(Date.now() + 28_000));
    object.chunks = [{ index: 0, key: "users/download-owner/chunk0", size: 20 }, { index: 1, key: "users/download-owner/chunk1", size: 20 }]; await object.save();
    const response = await stream(request(), args(link.token));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const data = await response.json(); expect(data.chunkUrls).toHaveLength(2);
    for (const url of data.chunkUrls) expect(Number(new URL(url).searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(28);
  });
  it("refuses an expired/revoked link without issuing a URL", async () => {
    const { link } = await fixture(new Date(Date.now() - 1000));
    expect((await stream(request(), args(link.token))).status).toBe(410);
    link.expiresAt = undefined; link.isRevoked = true; await link.save();
    expect((await stream(request(), args(link.token))).status).toBe(404);
  });
  it("atomically enforces the final download allowance across concurrent requests", async () => {
    const { link } = await fixture(); link.maxDownloads = 1; await link.save();
    const responses = await Promise.all([download(request(), args(link.token)), download(request(), args(link.token))]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 410]);
    expect((await ShareLink.findById(link._id))?.downloadCount).toBe(1);
  });
  it("key-only thumbnail access respects expiry, passwords and live object lifecycle", async () => {
    const { link, object } = await fixture(new Date(Date.now() + 18_000));
    const access = await resolveThumbnailAccess("shares/thumbnail", null);
    expect(access?.expiresIn).toBeLessThanOrEqual(18);
    link.isPasswordProtected = true; await link.save();
    expect(await resolveThumbnailAccess("shares/thumbnail", null)).toBeNull();
    link.isPasswordProtected = false; link.expiresAt = new Date(Date.now() - 1000); await link.save();
    expect(await resolveThumbnailAccess("shares/thumbnail", null)).toBeNull();
    link.expiresAt = undefined; await link.save(); object.deletedAt = new Date(); await object.save();
    expect(await resolveThumbnailAccess("shares/thumbnail", null)).toBeNull();
  });
  it("returns direct URLs for each retained version chunk without fetching bytes", async () => {
    const { object } = await fixture();
    object.versions = [{ versionId: "previous", b2FileId: "previous", key: "users/download-owner/old", size: 40, createdAt: new Date(), createdBy: "download-owner", chunks: [{ index: 0, key: "users/download-owner/old-part", size: 40 }] }]; await object.save();
    context.mockResolvedValue({ accountId: "download-owner", userId: "download-owner", spaceId: object.spaceId, productId: "drive", spaceType: "personal", role: "owner", region: "asia", session: { session: { expiresAt: new Date(Date.now() + 12_000) } } });
    const response = await content(new NextRequest("http://localhost/content?version=previous"), { params: Promise.resolve({ id: String(object._id) }) });
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.objectId).toBe(String(object._id)); expect(result.url).toBeUndefined();
    expect(new URL(result.chunkUrls[0]).pathname).toContain("old-part");
    expect(Number(new URL(result.chunkUrls[0]).searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(12);
    object.versions![0].pendingDeletion = true; await object.save();
    expect((await content(new NextRequest("http://localhost/content?version=previous"), { params: Promise.resolve({ id: String(object._id) }) })).status).toBe(409);
  });
  it("authenticates each downloaded part and refuses corruption before publishing a Blob", async () => {
    const fileId = "0123456789abcdef01234567", key = await generateFileKey();
    const source = new Uint8Array([1,2,3,4,5,6]).buffer;
    const sealed = await encryptFileChunks(source, key, { fileId }, 4);
    const layout = { chunkIvs: JSON.stringify(sealed.ivs.map(iv => Buffer.from(iv).toString("base64"))), chunkSize: 4 };
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => new Response(sealed.chunks[Number(String(input).slice(-1))]));
    const urls = { objectId: fileId, chunkUrls: ["https://r2.test/0", "https://r2.test/1"] };
    expect(new Uint8Array(await (await downloadCiphertextBlob(urls, key, layout, fileId, "application/octet-stream")).arrayBuffer())).toEqual(new Uint8Array(source));
    expect(fetcher).toHaveBeenCalledWith("https://r2.test/0", { credentials: "omit", cache: "no-store" });
    await expect(downloadCiphertextBlob({ ...urls, objectId: "ffffffffffffffffffffffff" }, key, layout, fileId, "text/plain")).rejects.toThrow("identity");
    await expect(downloadCiphertextBlob({ ...urls, chunkUrls: [...urls.chunkUrls].reverse() }, key, layout, fileId, "text/plain")).rejects.toThrow();
    fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(downloadCiphertextBlob(urls, key, layout, fileId, "text/plain")).rejects.toThrow("fresh access"); fetcher.mockRestore();
  });
});
