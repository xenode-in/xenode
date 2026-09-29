import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Space } from "@xenode/database";

const mocks = vi.hoisted(() => ({
  deleteObjects: vi.fn(), decrementStorageBulk: vi.fn(), decrementOrgStorage: vi.fn(),
  updateBucketStats: vi.fn(), requireAccessContext: vi.fn(),
}));
vi.mock("@/lib/b2/objects", () => ({ deleteObjects: mocks.deleteObjects }));
vi.mock("@/lib/metering/usage", () => ({ decrementStorageBulk: mocks.decrementStorageBulk, updateBucketStats: mocks.updateBucketStats }));
vi.mock("@/lib/orgs/billing/orgUsage", () => ({ decrementOrgStorage: mocks.decrementOrgStorage }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authz")>(), requireAccessContext: mocks.requireAccessContext,
}));
vi.mock("@/lib/subscriptions/service", () => ({ enforceStorageAccess: vi.fn() }));
vi.mock("@/lib/logRequest", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/albums/cleanup", () => ({ removeObjectsFromAlbums: vi.fn() }));

import { GET } from "@/app/api/cron/purge-bin/route";
import { POST } from "@/app/api/objects/purge/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

const accountId = "purge-owner";
const spaceId = `space_personal_${accountId}`;
const deletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

function cronRequest() {
  return new NextRequest("http://localhost/api/cron/purge-bin", { headers: { authorization: "Bearer purge-test" } });
}

async function seed() {
  const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
  await Space.create({ _id: spaceId, type: "personal", ownerAccountId: accountId, createdByAccountId: accountId });
  const object = await StorageObject.create({
    bucketId: bucket._id, spaceId, createdByAccountId: "uploader-is-not-the-billing-owner",
    key: `users/${accountId}/main`, size: 100, b2FileId: "test", deletedAt,
    chunks: [{ index: 0, key: `users/${accountId}/main-chunk-0`, size: 100 }],
    thumbnail: `users/${accountId}/main-thumb`, thumbnailSize: 20,
    optimizedKey: `users/${accountId}/optimized`, optimizedSize: 30,
    versions: [
      { versionId: "previous", key: `users/${accountId}/previous`, size: 50, createdAt: new Date(), createdBy: accountId },
      { versionId: "original", key: `users/${accountId}/main`, size: 100, sharesCurrentContent: true, createdAt: new Date(), createdBy: accountId },
    ],
  });
  return { bucket, object };
}

describe("Bin purge deletion safety", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "purge-test";
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireAccessContext.mockResolvedValue({ userId: accountId, accountId, spaceId, spaceType: "personal", role: "owner", productId: "drive", region: "asia" });
  });

  it("deletes every current/retained blob and meters the personal Space owner", async () => {
    const { bucket, object } = await seed();
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    expect(mocks.deleteObjects).toHaveBeenCalledWith(bucket.b2BucketId, expect.arrayContaining([
      object.key, `${object.key}-chunk-0`, `${object.key}-thumb`, `users/${accountId}/optimized`, `users/${accountId}/previous`,
    ]));
    expect(mocks.decrementStorageBulk).toHaveBeenCalledWith(accountId, 200, 1);
    expect(await StorageObject.findById(object._id)).toBeNull();
  });

  it("meters a team Space against its organization", async () => {
    const { object } = await seed();
    await Space.create({ _id: "space_team_org_team", type: "team", organizationId: "org", teamId: "team", createdByAccountId: accountId });
    await StorageObject.updateOne({ _id: object._id }, { $set: { spaceId: "space_team_org_team" } });
    expect((await GET(cronRequest())).status).toBe(200);
    expect(mocks.decrementOrgStorage).toHaveBeenCalledWith("org", 200, 1);
    expect(mocks.decrementStorageBulk).not.toHaveBeenCalled();
  });

  it("retains the record and accounting when deletion fails", async () => {
    const { object } = await seed();
    mocks.deleteObjects.mockRejectedValueOnce(new Error("storage unavailable"));
    expect((await GET(cronRequest())).status).toBe(500);
    expect(await StorageObject.findById(object._id)).not.toBeNull();
    expect(mocks.decrementStorageBulk).not.toHaveBeenCalled();
    expect(mocks.updateBucketStats).not.toHaveBeenCalled();
  });

  it.each(["bucket", "space"])("fails before deleting blobs when %s metadata is missing", async (kind) => {
    const { bucket, object } = await seed();
    if (kind === "bucket") await Bucket.deleteOne({ _id: bucket._id });
    else await Space.deleteOne({ _id: spaceId });
    expect((await GET(cronRequest())).status).toBe(500);
    expect(await StorageObject.findById(object._id)).not.toBeNull();
    expect(mocks.deleteObjects).not.toHaveBeenCalled();
  });

  it("does not meter overlapping folder and child selections twice", async () => {
    const { bucket, object } = await seed();
    const folder = await StorageObject.create({ bucketId: bucket._id, spaceId, createdByAccountId: accountId, key: `users/${accountId}/`, size: 0, b2FileId: "folder", deletedAt });
    const response = await POST(new NextRequest("http://localhost/api/objects/purge", {
      method: "POST", body: JSON.stringify({ bucketId: String(bucket._id), ids: [String(folder._id), String(object._id)] }), headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).purgedCount).toBe(2);
    expect(mocks.decrementStorageBulk).toHaveBeenCalledWith(accountId, 200, 2);
  });

  it("retains manual-purge records when deletion fails", async () => {
    const { bucket, object } = await seed();
    mocks.deleteObjects.mockRejectedValueOnce(new Error("partial storage deletion"));
    const response = await POST(new NextRequest("http://localhost/api/objects/purge", {
      method: "POST", body: JSON.stringify({ bucketId: String(bucket._id), ids: [String(object._id)] }), headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(500);
    expect(await StorageObject.findById(object._id)).not.toBeNull();
    expect(mocks.decrementStorageBulk).not.toHaveBeenCalled();
  });
});
