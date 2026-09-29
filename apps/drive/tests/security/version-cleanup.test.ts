import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space, cleanupDriveVersion, queueDriveVersionDeletion, restoreDriveVersion, getDatabase, VERSION_CLEANUP_LEASE_MS } from "@xenode/database";
const { deleted } = vi.hoisted(() => ({ deleted: vi.fn() }));
vi.mock("@/lib/b2/objects", () => ({ deleteObjects: deleted }));
import { GET as cron } from "@/app/api/cron/cleanup-versions/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";
import OrgUsage from "@/models/OrgUsage";

async function fixture(organization = false) {
  const spaceId = organization ? "space_org_version-org" : "space_personal_version-owner";
  await Space.create({ _id: spaceId, type: organization ? "organization" : "personal",
    ownerAccountId: organization ? undefined : "version-owner", organizationId: organization ? "version-org" : undefined, createdByAccountId: "version-owner" });
  const bucket = await Bucket.create({ name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage", totalSizeBytes: 180, objectCount: 1 });
  const object = await StorageObject.create({
    bucketId: bucket._id, spaceId, createdByAccountId: "version-owner",
    key: "users/version-owner/current", size: 100, b2FileId: "current", isEncrypted: true, encryptedDEK: "wrapped", iv: "current",
    versions: [
      { versionId: "original", isOriginal: true, key: "users/version-owner/original", size: 50, createdAt: new Date(), createdBy: "version-owner" },
      { versionId: "expired", pendingDeletion: true, key: "users/version-owner/expired", size: 30, createdAt: new Date(), createdBy: "version-owner" },
    ],
  });
  if (organization) await OrgUsage.create({ orgId: "version-org", accountId: "org:version-org", totalStorageBytes: 180, totalObjects: 1 });
  else await Usage.create({ userId: "version-owner", totalStorageBytes: 180, totalObjects: 1 });
  return { object, bucket, spaceId, objectId: object._id, versionId: "expired" };
}
const cleanup = (input: Awaited<ReturnType<typeof fixture>>, now?: Date) => cleanupDriveVersion({ ...input, now, deleteBlobs: deleted });
async function version(input: Awaited<ReturnType<typeof fixture>>) {
  return (await StorageObject.findById(input.objectId))?.versions?.find((item) => item.versionId === input.versionId);
}

describe("confirmed version deletion and transactional restore", () => {
  beforeEach(() => { deleted.mockReset(); process.env.CRON_SECRET = "version-test"; });
  it.each([false,true])("deletes ciphertext before atomically retiring references and owner bytes (organization=%s)", async (organization) => {
    const input = await fixture(organization);
    deleted.mockImplementation(async () => {
      expect(await version(input)).toBeDefined();
      expect((await Bucket.findById(input.bucket._id))?.totalSizeBytes).toBe(180);
    });
    expect(await cleanup(input)).toBe("deleted");
    expect(deleted).toHaveBeenCalledWith(input.bucket.b2BucketId, ["users/version-owner/expired"]);
    expect(await version(input)).toBeUndefined();
    expect((await Bucket.findById(input.bucket._id))?.totalSizeBytes).toBe(150);
    expect(organization ? (await OrgUsage.findOne({ orgId: "version-org" }))?.totalStorageBytes : (await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(150);
    expect(await cleanup(input)).toBe("skipped");
  });
  it("retains retryable references and quota after a B2 per-key failure", async () => {
    const input = await fixture(), now = new Date();
    deleted.mockRejectedValueOnce(new Error("per-key failure"));
    expect(await cleanup(input, now)).toBe("retry");
    expect(await version(input)).toBeDefined();
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
    expect(await cleanup(input, now)).toBe("skipped");
    expect(await cleanup(input, new Date(now.getTime()+61_000))).toBe("deleted");
  });
  it("keeps metadata and Usage unchanged when post-delete accounting fails", async () => {
    const input = await fixture(), now = new Date();
    deleted.mockImplementationOnce(async () => { await Bucket.deleteOne({ _id: input.bucket._id }); });
    expect(await cleanup(input, now)).toBe("retry");
    expect(await version(input)).toBeDefined();
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
  });
  it("admits one cleanup owner and keeps an in-flight claim fenced", async () => {
    const input = await fixture();
    let start!:()=>void, finish!:()=>void;
    const started = new Promise<void>((done)=>{ start=done; });
    const ended = new Promise<void>((done)=>{ finish=done; });
    deleted.mockImplementation(async()=>{ start(); await ended; });
    const work = cleanup(input); await started;
    expect(await cleanup(input)).toBe("skipped");
    expect(deleted).toHaveBeenCalledOnce();
    finish(); expect(await work).toBe("deleted");
  });
  it("recovers an interrupted lease after expiry", async () => {
    const input = await fixture(), now = new Date();
    await StorageObject.updateOne({ _id: input.objectId, "versions.versionId": input.versionId }, { $set: {
      "versions.$.cleanupLeaseId": "interrupted", "versions.$.cleanupLeaseExpiresAt": new Date(now.getTime()+VERSION_CLEANUP_LEASE_MS),
    } });
    expect(await cleanup(input, now)).toBe("skipped");
    expect(await cleanup(input, new Date(now.getTime()+VERSION_CLEANUP_LEASE_MS+1))).toBe("deleted");
  });
  it("cannot retire another worker's lease", async () => {
    const input = await fixture();
    deleted.mockImplementationOnce(async()=>{ await StorageObject.updateOne({ _id: input.objectId, "versions.versionId": input.versionId }, { $set: { "versions.$.cleanupLeaseId": "replacement" } }); });
    expect(await cleanup(input)).toBe("skipped");
    expect((await version(input))?.cleanupLeaseId).toBe("replacement");
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
  });
  it.each(["current","original","photos-bin"])("protects a %s reference to a deletion candidate", async (kind) => {
    const input = await fixture();
    if (kind === "current") await StorageObject.updateOne({ _id: input.objectId }, { $set: { key: "users/version-owner/expired" } });
    if (kind === "original") await StorageObject.updateOne({ _id: input.objectId, "versions.versionId": "original" }, { $set: { "versions.$.key": "users/version-owner/expired" } });
    if (kind === "photos-bin") await getDatabase().collection("storageobjects").insertOne({ bucketId: input.bucket._id, productId: "photos", key: "photo", thumbnail: "users/version-owner/expired", deletedAt: new Date() });
    expect(await cleanup(input)).toBe("blocked");
    expect(deleted).not.toHaveBeenCalled();
    expect((await version(input))?.deletionState).toBe("blocked");
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
  });
  it("rejects restore of a pending version without losing its cleanup record", async () => {
    const input = await fixture();
    await expect(restoreDriveVersion({ ...input, accountId: "version-owner", baseRevision: 0 })).rejects.toMatchObject({ code: "version_deletion_pending" });
    expect(await version(input)).toBeDefined();
    expect((await StorageObject.findById(input.objectId))?.revision).toBe(0);
  });
  it("restores the original with stable physical accounting and preserves pending cleanup", async () => {
    const input = await fixture();
    expect(await restoreDriveVersion({ ...input, versionId: "original", accountId: "version-owner", baseRevision: 0 })).toEqual({ revision: 1 });
    const saved = await StorageObject.findById(input.objectId);
    expect(saved?.key).toBe("users/version-owner/original");
    expect(saved?.versions?.find((item)=>item.versionId==="original")?.sharesCurrentContent).toBe(true);
    expect(await version(input)).toBeDefined();
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
    await expect(restoreDriveVersion({ ...input, versionId: "original", accountId: "version-owner", baseRevision: 0 })).rejects.toMatchObject({ code: "revision_conflict" });
  });
  it("queues deletion idempotently without discarding references or freeing quota", async () => {
    const input = await fixture();
    await StorageObject.updateOne({ _id: input.objectId, "versions.versionId": input.versionId }, { $set: { "versions.$.pendingDeletion": false } });
    await queueDriveVersionDeletion(input); await queueDriveVersionDeletion(input);
    expect((await version(input))?.pendingDeletion).toBe(true);
    expect(deleted).not.toHaveBeenCalled();
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
    await expect(queueDriveVersionDeletion({ ...input, versionId: "original" })).rejects.toMatchObject({ code: "original_version_protected" });
  });
  it("authenticates cron and runs exact eligible version entries", async () => {
    const input = await fixture();
    expect((await cron(new NextRequest("http://localhost/cron"))).status).toBe(401);
    const response = await cron(new NextRequest("http://localhost/cron", { headers: { authorization: "Bearer version-test" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(1);
    expect(await version(input)).toBeUndefined();
  });
  it("permits one concurrent restore of a base revision", async () => {
    const input = await fixture();
    const outcomes = await Promise.allSettled([1,2].map(() => restoreDriveVersion({ ...input, versionId: "original", accountId: "version-owner", baseRevision: 0 })));
    expect(outcomes.filter((item)=>item.status==="fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item)=>item.status==="rejected")).toHaveLength(1);
    expect((await StorageObject.findById(input.objectId))?.revision).toBe(1);
    expect((await Usage.findOne({ userId: "version-owner" }))?.totalStorageBytes).toBe(180);
  });
  it("bounds a cron request to 100 embedded snapshots", async () => {
    const input = await fixture();
    await StorageObject.updateOne({ _id: input.objectId }, { $push: { versions: { $each: Array.from({ length: 100 }, (_, index)=>({
      versionId: `extra-${index}`, key: `users/version-owner/extra-${index}`, size: 30, pendingDeletion: true, createdAt: new Date(), createdBy: "version-owner",
    })) } } });
    await Usage.updateOne({ userId: "version-owner" }, { $set: { totalStorageBytes: 3180 } });
    await Bucket.updateOne({ _id: input.bucket._id }, { $set: { totalSizeBytes: 3180 } });
    const response = await cron(new NextRequest("http://localhost/cron", { headers: { authorization: "Bearer version-test" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).scanned).toBe(100);
    expect(deleted).toHaveBeenCalledTimes(100);
    expect((await StorageObject.findById(input.objectId))?.versions?.filter((item)=>item.pendingDeletion)).toHaveLength(1);
  });
});
