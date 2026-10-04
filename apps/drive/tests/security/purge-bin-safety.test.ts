import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space, queueDriveBinPurge, restoreDriveBin, cleanupDriveBinObject, getDatabase, BIN_PURGE_LEASE_MS } from "@xenode/database";
const { deleted, ctx } = vi.hoisted(() => ({ deleted: vi.fn(), ctx: vi.fn() }));
vi.mock("@/lib/b2/objects", () => ({ deleteObjects: deleted }));
vi.mock("@/lib/b2/cdn", () => ({ getSignedFileUrl: vi.fn(async (_bucket: string, key: string) => `https://cdn.example.test/${key}`) }));
vi.mock("@/lib/authz", async (original) => ({ ...await original<typeof import("@/lib/authz")>(), requireAccessContext: ctx }));
vi.mock("@/lib/realtime/publish", () => ({ publishSyncEvent: vi.fn(async () => {}) }));
import { GET as cron } from "@/app/api/cron/purge-bin/route";
import { POST as purge } from "@/app/api/objects/purge/route";
import { POST as restore } from "@/app/api/objects/restore/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";
import OrgUsage from "@/models/OrgUsage";
import UploadSession from "@/models/UploadSession";
import DirectShare from "@/models/DirectShare";
import PhotoAlbum from "@/models/PhotoAlbum";
import ShareLink from "@/models/ShareLink";
import AlbumShareLink from "@/models/AlbumShareLink";
import { GET as publicShareGET } from "@/app/api/share/[token]/route";
import { POST as publicStreamPOST } from "@/app/api/share/[token]/stream/route";
import { POST as publicDownloadPOST } from "@/app/api/share/[token]/download/route";

const owner = "bin-owner", spaceId = `space_personal_${owner}`;
function request(body: object) { return new NextRequest("http://localhost/bin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function fixture(team = false) {
  const sid = team ? "space_team_bin-org_team" : spaceId;
  await Space.create({ _id: sid, type: team ? "team" : "personal", ownerAccountId: team ? undefined : owner, organizationId: team ? "bin-org" : undefined, teamId: team ? "team" : undefined, createdByAccountId: owner });
  const bucket = await Bucket.create({ name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage", storageRegion: "asia", objectCount: 1, totalSizeBytes: 200 });
  const object = await StorageObject.create({
    bucketId: bucket._id, spaceId: sid, createdByAccountId: "different-uploader", key: `users/${owner}/main`, size: 100, b2FileId: "main",
    deletedAt: new Date(Date.now()-31*24*60*60*1000),
    chunks: [{ index: 0, key: `users/${owner}/chunk`, size: 100 }],
    thumbnail: `users/${owner}/thumb`, thumbnailSize: 20, optimizedKey: `users/${owner}/optimized`, optimizedSize: 30,
    versions: [
      { versionId: "prior", key: `users/${owner}/prior`, size: 50, createdAt: new Date(), createdBy: owner },
      { versionId: "shared", key: `users/${owner}/main`, size: 100, sharesCurrentContent: true, createdAt: new Date(), createdBy: owner },
    ],
  });
  if (team) await OrgUsage.create({ orgId: "bin-org", accountId: "org:bin-org", totalStorageBytes: 200, totalObjects: 1 });
  else await Usage.create({ userId: owner, totalStorageBytes: 200, totalObjects: 1 });
  return { object, bucket, spaceId: sid, objectId: object._id, bucketId: bucket._id, ids: [object._id] };
}
async function queue(input: Awaited<ReturnType<typeof fixture>>) { return queueDriveBinPurge(input); }
async function clean(input: Awaited<ReturnType<typeof fixture>>, now?: Date) { return cleanupDriveBinObject({ objectId: input.objectId, now, deleteBlobs: deleted }); }
const lookup = (input: Awaited<ReturnType<typeof fixture>>) => getDatabase().collection("storageobjects").findOne({ _id: input.objectId });
describe("durable Bin purge and restore", () => {
  beforeEach(() => {
    deleted.mockReset(); ctx.mockReset(); process.env.CRON_SECRET = "bin-test";
    ctx.mockResolvedValue({ accountId: owner, userId: owner, spaceId, spaceType: "personal", role: "owner", productId: "drive", region: "asia" });
  });
  it.each([false,true])("confirms all ciphertext then atomically retires owner accounting (team=%s)", async (team) => {
    const input = await fixture(team);
    await queue(input);
    deleted.mockImplementation(async()=>{ expect(await lookup(input)).not.toBeNull(); expect((await Bucket.findById(input.bucketId))?.totalSizeBytes).toBe(200); });
    expect(await clean(input)).toBe("deleted");
    expect(deleted).toHaveBeenCalledWith(input.bucket.b2BucketId, expect.arrayContaining(["users/bin-owner/main","users/bin-owner/chunk","users/bin-owner/thumb","users/bin-owner/optimized","users/bin-owner/prior"]));
    expect(await lookup(input)).toBeNull();
    expect((await Bucket.findById(input.bucketId))?.toObject()).toMatchObject({ totalSizeBytes: 0, objectCount: 0 });
    expect(team ? (await OrgUsage.findOne({ orgId: "bin-org" }))?.totalStorageBytes : (await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(0);
    expect(await clean(input)).toBe("skipped");
  });
  it("keeps a failed purge charged and permanently non-restorable", async () => {
    const input = await fixture(); await queue(input); const now = new Date();
    deleted.mockRejectedValueOnce(new Error("per-key deletion"));
    expect(await clean(input, now)).toBe("retry");
    expect((await lookup(input))?.purgeState).toBe("pending");
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(200);
    await expect(restoreDriveBin(input)).rejects.toMatchObject({ code: "purge_pending" });
    expect(await clean(input, now)).toBe("skipped");
    expect(await clean(input, new Date(now.getTime()+61_000))).toBe("deleted");
  });
  it("rolls back metadata and Usage retirement if bucket accounting disappears after B2 deletion", async () => {
    const input = await fixture(); await queue(input);
    deleted.mockImplementationOnce(async()=>{ await Bucket.deleteOne({ _id: input.bucketId }); });
    expect(await clean(input)).toBe("retry");
    expect(await lookup(input)).not.toBeNull();
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(200);
    expect((await Usage.findOne({ userId: owner }))?.totalObjects).toBe(1);
  });
  it.each(["bucket","space","usage"])("fails before deleting blobs when %s data is missing", async (kind) => {
    const input = await fixture();
    if (kind==="bucket") await Bucket.deleteOne({ _id: input.bucketId });
    if (kind==="space") await Space.deleteOne({ _id: input.spaceId });
    if (kind==="usage") await Usage.deleteOne({ userId: owner });
    await expect(queue(input)).rejects.toBeDefined();
    expect(deleted).not.toHaveBeenCalled();
    expect((await lookup(input))?.purgeState).toBeUndefined();
  });
  it("lets restore win before purge intent without deleting restored bytes", async () => {
    const input = await fixture();
    expect(await restoreDriveBin(input)).toEqual({ restoredCount: 1 });
    expect(await queue(input)).toHaveLength(0);
    expect(await clean(input)).toBe("skipped");
    expect(deleted).not.toHaveBeenCalled();
    expect((await lookup(input))?.deletedAt).toBeUndefined();
  });
  it("serializes concurrent restore versus purge intent", async () => {
    const input = await fixture();
    const results = await Promise.allSettled([queue(input),restoreDriveBin(input)]);
    const current = await lookup(input);
    if (current?.purgeState) {
      expect(current.deletedAt).toBeDefined();
      expect(results[1].status).toBe("rejected");
    } else {
      expect(current?.deletedAt).toBeUndefined();
      expect(results[1].status).toBe("fulfilled");
    }
  });
  it("denies restore while B2 deletion is in progress", async () => {
    const input = await fixture(); await queue(input);
    deleted.mockImplementationOnce(async()=>{ await expect(restoreDriveBin(input)).rejects.toMatchObject({ code: "purge_pending" }); });
    expect(await clean(input)).toBe("deleted");
  });
  it("admits one concurrent cleanup worker", async () => {
    const input = await fixture(); await queue(input);
    let start!:()=>void, finish!:()=>void;
    const started = new Promise<void>((resolve)=>{ start=resolve; }), ended = new Promise<void>((resolve)=>{ finish=resolve; });
    deleted.mockImplementation(async()=>{ start(); await ended; });
    const work = clean(input); await started;
    expect(await clean(input)).toBe("skipped");
    finish(); expect(await work).toBe("deleted"); expect(deleted).toHaveBeenCalledOnce();
  });
  it("recovers an interrupted lease and fences a stale worker", async () => {
    const input = await fixture(), now = new Date(); await queue(input);
    await getDatabase().collection("storageobjects").updateOne({ _id: input.objectId }, { $set: { purgeLeaseId: "dead", purgeLeaseExpiresAt: new Date(now.getTime()+BIN_PURGE_LEASE_MS) } });
    expect(await clean(input, now)).toBe("skipped");
    deleted.mockImplementationOnce(async()=>{ await getDatabase().collection("storageobjects").updateOne({ _id: input.objectId }, { $set: { purgeLeaseId: "replacement" } }); });
    expect(await clean(input, new Date(now.getTime()+BIN_PURGE_LEASE_MS+1))).toBe("skipped");
    expect((await lookup(input))?.purgeLeaseId).toBe("replacement");
    expect((await Usage.findOne({ userId: owner }))?.totalStorageBytes).toBe(200);
  });
  it("preserves a cross-product retained reference", async () => {
    const input = await fixture(); await queue(input);
    await getDatabase().collection("storageobjects").insertOne({ productId: "photos", bucketId: input.bucketId, thumbnail: input.object.thumbnail, key: "photo" });
    expect(await clean(input)).toBe("blocked");
    expect(deleted).not.toHaveBeenCalled();
    expect((await lookup(input))?.purgeState).toBe("blocked");
  });
  it("waits for every recorded PUT grace window", async () => {
    const input = await fixture(), deadline = new Date(Date.now()+60_000);
    await UploadSession.create({ userId: owner, spaceId, bucketId: input.bucketId, fileId: input.object.key, keys: [input.object.key], status: "completed", expiresAt: deadline });
    await queue(input);
    expect(await clean(input)).toBe("skipped"); expect(deleted).not.toHaveBeenCalled();
    expect(await clean(input, new Date(deadline.getTime()+1))).toBe("deleted");
  });
  it("fences stale saves and generic mutations after queueing", async () => {
    const input = await fixture(); const stale = await StorageObject.findById(input.objectId);
    await queue(input);
    stale!.position=4; await expect(stale!.save()).rejects.toMatchObject({ name: "VersionError" });
    const modified = await StorageObject.updateOne({ _id: input.objectId }, { $unset: { deletedAt: "" }, $set: { key: "tampered" } });
    expect(modified.modifiedCount).toBe(0);
    expect((await lookup(input))?.key).toBe(input.object.key);
  });
  it("deduplicates overlapping folder/child selection and uses one owner", async () => {
    const input = await fixture();
    const folder = await StorageObject.create({ bucketId: input.bucketId, spaceId, createdByAccountId: owner, key: `users/${owner}/folder/`, contentType: "application/x-directory", size: 0, b2FileId: "", deletedAt: input.object.deletedAt });
    await StorageObject.updateOne({ _id: input.objectId }, { $set: { folderId: folder._id, ancestorIds: [folder._id] } });
    await Usage.updateOne({ userId: owner }, { $inc: { totalObjects: 1 } }); await Bucket.updateOne({ _id: input.bucketId }, { $inc: { objectCount: 1 } });
    const selected = await queueDriveBinPurge({ ...input, ids: [folder._id, input.objectId] });
    expect(selected).toHaveLength(2);
    for (const objectId of selected) expect(await cleanupDriveBinObject({ objectId, deleteBlobs: deleted })).toBe("deleted");
    expect((await Usage.findOne({ userId: owner }))?.totalObjects).toBe(0);
    expect(deleted).toHaveBeenCalledOnce();
  });
  it("retires share and album relationships in the same commit", async () => {
    const input = await fixture();
    await DirectShare.create({ bucketId: input.bucketId, objectId: input.objectId, createdBy: owner, recipients: [{ recipientUserId: "other", recipientEmail: "other@test.test", wrappedShareKey: "wrap" }] });
    const album = await PhotoAlbum.create({ spaceId, createdByAccountId: owner, slug: "album", objectIds: [input.objectId], coverObjectId: input.objectId });
    await queue(input); expect(await clean(input)).toBe("deleted");
    expect(await DirectShare.countDocuments({ objectId: input.objectId })).toBe(0);
    expect((await PhotoAlbum.findById(album._id))?.objectIds).toHaveLength(0);
    expect((await PhotoAlbum.findById(album._id))?.coverObjectId).toBeNull();
  });
  it("prunes public bundles and album manifests without invalidating surviving files", async () => {
    const input = await fixture();
    const makeSibling = (suffix: string) => StorageObject.create({
      bucketId: input.bucketId, spaceId, createdByAccountId: owner,
      key: `users/${owner}/${suffix}`, size: 100, b2FileId: suffix,
    });
    const second = await makeSibling("second"), third = await makeSibling("third");
    await Usage.updateOne({ userId: owner }, { $inc: { totalStorageBytes: 200, totalObjects: 2 } });
    await Bucket.updateOne({ _id: input.bucketId }, { $inc: { totalSizeBytes: 200, objectCount: 2 } });
    const item = (objectId: typeof input.objectId) => ({ objectId, shareEncryptedDEK: "ciphertext", shareKeyIv: "iv" });
    await ShareLink.create({ token: "bundle-retained", objectId: input.objectId, bucketId: input.bucketId,
      createdBy: owner, accessType: "download", isBundle: true,
      bundleItems: [item(input.objectId), item(second._id), item(third._id)] });
    await ShareLink.create({ token: "single-removed", objectId: input.objectId, bucketId: input.bucketId,
      createdBy: owner, accessType: "download" });
    const album = await PhotoAlbum.create({ spaceId, createdByAccountId: owner, slug: "shared", objectIds: [input.objectId, second._id] });
    await AlbumShareLink.create({ token: "album-retained", albumId: album._id, createdBy: owner,
      items: [item(input.objectId), item(second._id)] });

    await queue(input);
    expect(await clean(input)).toBe("deleted");
    const bundle = await ShareLink.findOne({ token: "bundle-retained" }).lean();
    expect(bundle?.bundleItems?.map((entry) => String(entry.objectId))).toEqual([String(second._id), String(third._id)]);
    expect(String(bundle?.objectId)).toBe(String(second._id));
    expect(bundle?.__v).toBe(1);
    expect(await ShareLink.findOneAndUpdate({ _id: bundle!._id, __v: 0 }, {
      $set: { bundleItems: [item(input.objectId), item(second._id), item(third._id)] },
    })).toBeNull();
    expect(await ShareLink.countDocuments({ token: "single-removed" })).toBe(0);
    expect((await AlbumShareLink.findOne({ token: "album-retained" }))?.items.map((entry) => String(entry.objectId))).toEqual([String(second._id)]);
    expect((await publicShareGET(new NextRequest("http://localhost/share"), { params: Promise.resolve({ token: "bundle-retained" }) })).status).toBe(200);

    await StorageObject.updateOne({ _id: second._id }, { $set: { deletedAt: new Date() } });
    await queueDriveBinPurge({ spaceId, bucketId: input.bucketId, ids: [second._id], includeRelated: false });
    expect(await cleanupDriveBinObject({ objectId: second._id, deleteBlobs: deleted })).toBe("deleted");
    const survivingBundle = await ShareLink.findOne({ token: "bundle-retained" }).lean();
    expect(survivingBundle?.bundleItems).toHaveLength(1);
    expect(String(survivingBundle?.objectId)).toBe(String(third._id));
    expect(await AlbumShareLink.countDocuments({ token: "album-retained" })).toBe(0);
    expect((await publicShareGET(new NextRequest("http://localhost/share"), { params: Promise.resolve({ token: "bundle-retained" }) })).status).toBe(200);
    const bundleParams = { params: Promise.resolve({ token: "bundle-retained" }) };
    const stream = await publicStreamPOST(request({}), bundleParams);
    const download = await publicDownloadPOST(request({}), bundleParams);
    expect(stream.status).toBe(200);
    expect(download.status).toBe(200);
    expect((await stream.json()).streamUrl).toContain("users/bin-owner/third");
    expect((await download.json()).downloadUrl).toContain("users/bin-owner/third");
  });
  it("defers purging objects with charged pending versions", async () => {
    const input = await fixture(); await StorageObject.updateOne({ _id: input.objectId }, { $set: { "versions.0.pendingDeletion": true } });
    await expect(queue(input)).rejects.toMatchObject({ code: "version_cleanup_pending" });
    expect((await lookup(input))?.purgeState).toBeUndefined();
  });
  it("handles manual and authenticated cron requests with real accounting", async () => {
    const input = await fixture();
    expect((await cron(new NextRequest("http://localhost/cron"))).status).toBe(401);
    expect((await purge(request({ bucketId: String(input.bucketId), ids: [String(input.objectId)] }))).status).toBe(200);
    expect((await lookup(input))).toBeNull();
    expect((await restore(request({ bucketId: String(input.bucketId), ids: [String(input.objectId)] }))).status).toBe(200);
  });
  it("does not purge a recently binned child just because its folder expired", async () => {
    const input = await fixture();
    const oldDate = input.object.deletedAt;
    await StorageObject.updateOne({ _id: input.objectId }, { $set: { deletedAt: new Date() } });
    const folder = await StorageObject.create({ bucketId: input.bucketId, spaceId, createdByAccountId: owner, key: "users/bin-owner/folder/", contentType: "application/x-directory", size:0, b2FileId:"", deletedAt:oldDate });
    await StorageObject.updateOne({ _id: input.objectId }, { $set: { folderId: folder._id, ancestorIds: [folder._id] } });
    await Usage.updateOne({ userId:owner },{ $inc:{ totalObjects:1 } }); await Bucket.updateOne({ _id:input.bucketId },{ $inc:{ objectCount:1 } });
    const response = await cron(new NextRequest("http://localhost/cron",{ headers:{ authorization:"Bearer bin-test" } }));
    expect(response.status).toBe(200);
    expect(await StorageObject.findById(folder._id)).toBeNull();
    expect(await lookup(input)).not.toBeNull();
    expect(deleted).not.toHaveBeenCalled();
  });
  it("expands an explicit folder purge to the children binned with it", async () => {
    const input = await fixture();
    const folder = await StorageObject.create({ bucketId: input.bucketId, spaceId, createdByAccountId: owner, key: "users/bin-owner/folder/", contentType: "application/x-directory", size: 0, b2FileId: "", deletedAt: input.object.deletedAt });
    await StorageObject.updateOne({ _id: input.objectId }, { $set: { folderId: folder._id, ancestorIds: [folder._id] } });
    expect((await queueDriveBinPurge({ ...input, ids: [folder._id] })).map(String).sort()).toEqual([String(folder._id), String(input.objectId)].sort());
  });
  it("drains an expired folder batch larger than one manifest across cron runs", async () => {
    const input = await fixture();
    const deletedAt = input.object.deletedAt;
    const folder = await StorageObject.create({ bucketId: input.bucketId, spaceId, createdByAccountId: owner, key: "users/bin-owner/big/", contentType: "application/x-directory", size: 0, b2FileId: "", deletedAt });
    await StorageObject.insertMany(Array.from({ length: 120 }, (_, index) => ({
      bucketId: input.bucketId, spaceId, createdByAccountId: owner, key: `users/bin-owner/child-${index}`, size: 0, b2FileId: `child-${index}`,
      folderId: folder._id, ancestorIds: [folder._id], deletedAt,
    })));
    await Usage.updateOne({ userId: owner }, { $inc: { totalObjects: 121 } }); await Bucket.updateOne({ _id: input.bucketId }, { $inc: { objectCount: 121 } });
    const run = () => cron(new NextRequest("http://localhost/cron", { headers: { authorization: "Bearer bin-test" } }));
    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(200);
    expect(await StorageObject.countDocuments({ spaceId })).toBe(0);
    expect((await Usage.findOne({ userId: owner }))?.toObject()).toMatchObject({ totalObjects: 0, totalStorageBytes: 0 });
  });
});
