import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  PhotoAsset,
  PhotoAlbumV2,
  Space,
  DriveSyncTombstone,
  connectDatabase,
  disconnectDatabaseForTests,
  getDatabase,
  getMongoose,
  changePhotoTrash,
  queuePhotoAssetPurge,
  cleanupStorageBinObject,
} from "@xenode/database";
import { clearStorageConfigCacheForTests } from "@xenode/config/storage";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getPhotosProductSession: mocks.session }));
vi.mock("@/lib/storage-server", () => ({
  getPhotosS3Client: () => ({ send: mocks.send }),
}));
vi.mock("@xenode/spaces", async (original) => ({
  ...(await original<typeof import("@xenode/spaces")>()),
  resolveSpaceAccess: mocks.access,
}));
import { POST as trash } from "../app/api/photos/assets/trash/route";
import { POST as restore } from "../app/api/photos/assets/restore/route";
import { POST as purge } from "../app/api/photos/assets/purge/route";
import { GET as list } from "../app/api/photos/trash/route";
import { GET as cron } from "../app/api/cron/purge-photo-trash/route";
import { deletePhotoCiphertext } from "../lib/storage-delete";
const owner = "photo-owner",
  spaceId = `space_personal_${owner}`;
let server: MongoMemoryReplSet;
const oldUri = process.env.MONGODB_URI;
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  await connectDatabase();
  await PhotoAsset.init();
});
afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (oldUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = oldUri;
});
afterEach(async () => {
  for (const name of await getDatabase().listCollections().toArray())
    await getDatabase().collection(name.name).deleteMany({});
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STORAGE_ENABLED_REGIONS", "asia");
  vi.stubEnv("S3_BUCKET_NAME", "photo-bucket");
  vi.stubEnv("S3_ENDPOINT", "https://fixture.r2.cloudflarestorage.com");
  vi.stubEnv("S3_REGION", "auto");
  vi.stubEnv("CRON_SECRET", "photo-test-cron");
  clearStorageConfigCacheForTests();
  mocks.session.mockResolvedValue({ accountId: owner });
  mocks.access.mockResolvedValue({ role: "owner" });
  mocks.send.mockImplementation(async (command) => {
    if (command instanceof HeadObjectCommand)
      throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
    return {};
  });
});
async function fixture() {
  const db = getDatabase(),
    ObjectId = getMongoose().Types.ObjectId,
    objectId = new ObjectId(),
    bucketId = new ObjectId();
  await Space.create({
    _id: spaceId,
    type: "personal",
    ownerAccountId: owner,
    createdByAccountId: owner,
  });
  await db
    .collection("usages")
    .insertOne({
      userId: owner,
      totalStorageBytes: 120,
      totalObjects: 1,
      storageLimitBytes: 1000,
    });
  await db
    .collection("buckets")
    .insertOne({
      _id: bucketId,
      b2BucketId: "photo-bucket",
      storageRegion: "asia",
      totalSizeBytes: 120,
      objectCount: 1,
    });
  await db
    .collection("storageobjects")
    .insertOne({
      _id: objectId,
      bucketId,
      spaceId,
      productId: "photos",
      createdByAccountId: owner,
      key: "users/photo-owner/main",
      size: 100,
      thumbnail: "users/photo-owner/thumb",
      thumbnailSize: 20,
      isEncrypted: true,
    });
  await PhotoAsset.create({
    assetId: "asset",
    spaceId,
    storageObjectId: String(objectId),
    mediaType: "image",
    takenAt: new Date(),
    uploadSource: "web",
    createdByAccountId: owner,
  });
  return { db, objectId, bucketId };
}
function request(path: string, ids: string[] = ["asset"]) {
  return new Request(`http://localhost/api/photos/${path}?spaceId=${spaceId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetIds: ids }),
  });
}
const selection = { accountId: owner, spaceId, assetIds: ["asset"] };
async function clean(value: Awaited<ReturnType<typeof fixture>>, now?: Date) {
  return cleanupStorageBinObject({
    productId: "photos",
    objectId: value.objectId,
    now,
    deleteBlobs: async (_bucket, keys) =>
      deletePhotoCiphertext(value.bucketId, keys),
  });
}
describe("Photos transactional trash and permanent cleanup", () => {
  it("bins/restores idempotently while preserving keys and charged quota", async () => {
    const f = await fixture();
    expect((await trash(request("trash"))).status).toBe(200);
    expect((await PhotoAsset.findOne({ assetId: "asset" }))?.status).toBe(
      "trashed",
    );
    expect(
      (await f.db.collection("storageobjects").findOne({ _id: f.objectId }))
        ?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      (await f.db.collection("usages").findOne({ userId: owner }))
        ?.totalStorageBytes,
    ).toBe(120);
    expect(await changePhotoTrash(selection)).toEqual({ changedCount: 0 });
    expect((await restore(request("restore"))).status).toBe(200);
    expect((await PhotoAsset.findOne({ assetId: "asset" }))?.status).toBe(
      "active",
    );
    expect(
      (await f.db.collection("storageobjects").findOne({ _id: f.objectId }))
        ?.key,
    ).toBe("users/photo-owner/main");
  });
  it("refuses guests, foreign IDs and relabelled Drive objects atomically", async () => {
    const f = await fixture();
    mocks.access.mockResolvedValue({ role: "guest" });
    expect((await trash(request("trash"))).status).toBe(403);
    mocks.access.mockResolvedValue({ role: "owner" });
    expect((await trash(request("trash", ["asset", "foreign"]))).status).toBe(
      404,
    );
    await f.db
      .collection("storageobjects")
      .updateOne({ _id: f.objectId }, { $set: { productId: "drive" } });
    expect((await trash(request("trash"))).status).toBe(409);
    expect((await PhotoAsset.findOne({ assetId: "asset" }))?.status).toBe(
      "active",
    );
  });
  it("honors outstanding PUT expiry and refuses restore after purge intent", async () => {
    const f = await fixture();
    await changePhotoTrash(selection);
    await f.db
      .collection("photoUploads")
      .insertOne({
        bucketId: f.bucketId,
        original: { key: "users/photo-owner/main" },
        expiresAt: new Date(Date.now() + 60_000),
      });
    expect((await purge(request("purge"))).status).toBe(202);
    expect((await restore(request("restore"))).status).toBe(409);
    expect(await clean(f)).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(await clean(f, new Date(Date.now() + 61_000))).toBe("deleted");
  });
  it("confirms all variants before retiring assets, albums and accounting", async () => {
    const f = await fixture();
    await PhotoAlbumV2.create({
      albumId: "album",
      spaceId,
      encryptedName: "sealed",
      photoAssetIds: ["asset"],
      coverPhotoAssetId: "asset",
      createdByAccountId: owner,
    });
    await changePhotoTrash(selection);
    await queuePhotoAssetPurge(selection);
    expect(await clean(f)).toBe("deleted");
    expect(
      mocks.send.mock.calls.filter(
        ([command]) => command instanceof DeleteObjectsCommand,
      ),
    ).toHaveLength(1);
    expect(await PhotoAsset.findOne({ assetId: "asset" })).toBeNull();
    expect(
      (await PhotoAlbumV2.findOne({ albumId: "album" }))?.photoAssetIds,
    ).toEqual([]);
    expect(
      (await f.db.collection("usages").findOne({ userId: owner }))
        ?.totalStorageBytes,
    ).toBe(0);
    expect(await DriveSyncTombstone.countDocuments()).toBe(0);
    expect(await clean(f)).toBe("skipped");
  });
  it.each(["provider-error", "head-still-present"])(
    "retains charged metadata on %s",
    async (kind) => {
      const f = await fixture();
      await changePhotoTrash(selection);
      await queuePhotoAssetPurge(selection);
      mocks.send.mockImplementation(async (command) => {
        if (
          kind === "provider-error" &&
          command instanceof DeleteObjectsCommand
        )
          return { Errors: [{ Code: "AccessDenied" }] };
        return {};
      });
      expect(await clean(f)).toBe("retry");
      expect(await PhotoAsset.findOne({ assetId: "asset" })).not.toBeNull();
      expect(
        (await f.db.collection("usages").findOne({ userId: owner }))
          ?.totalStorageBytes,
      ).toBe(120);
      expect(await clean(f)).toBe("skipped");
    },
  );
  it("blocks cross-product retained keys before provider calls", async () => {
    const f = await fixture();
    await f.db
      .collection("storageobjects")
      .insertOne({
        bucketId: f.bucketId,
        spaceId: "other",
        productId: "drive",
        key: "users/photo-owner/main",
      });
    await changePhotoTrash(selection);
    await queuePhotoAssetPurge(selection);
    expect(await clean(f)).toBe("blocked");
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await restore(request("restore"))).status).toBe(409);
  });
  it("serializes restore versus purge without purging live objects", async () => {
    const f = await fixture();
    await changePhotoTrash(selection);
    await Promise.allSettled([
      changePhotoTrash({ ...selection, restore: true }),
      queuePhotoAssetPurge(selection),
    ]);
    const object = await f.db
        .collection("storageobjects")
        .findOne({ _id: f.objectId }),
      asset = await PhotoAsset.findOne({ assetId: "asset" });
    if (object?.purgeState) {
      expect(asset?.status).toBe("trashed");
      expect(asset?.purgeRequestedAt).toBeInstanceOf(Date);
    } else {
      expect(asset?.status).toBe("active");
      expect(object?.deletedAt).toBeUndefined();
    }
  });
  it("paginates equal-time trash without accepting malformed cursors", async () => {
    await fixture();
    await changePhotoTrash(selection);
    await PhotoAsset.create({
      assetId: "asset0",
      spaceId,
      storageObjectId: String(new (getMongoose().Types.ObjectId)()),
      mediaType: "video",
      takenAt: new Date(),
      trashedAt: (await PhotoAsset.findOne({ assetId: "asset" }))!.trashedAt,
      status: "trashed",
      uploadSource: "web",
      createdByAccountId: owner,
    });
    const data = await (
      await list(
        new Request(`http://localhost/trash?spaceId=${spaceId}&limit=1`),
      )
    ).json();
    expect(data.items).toHaveLength(1);
    expect(data.nextCursor).toBeTruthy();
    const b = await (
      await list(
        new Request(
          `http://localhost/trash?spaceId=${spaceId}&limit=1&cursor=${data.nextCursor}`,
        ),
      )
    ).json();
    expect(b.items).toHaveLength(1);
    expect(b.items[0].assetId).not.toBe(data.items[0].assetId);
    expect(
      (
        await list(
          new Request(`http://localhost/trash?spaceId=${spaceId}&cursor=bad`),
        )
      ).status,
    ).toBe(400);
    // Deleted forever: no longer listed, since it can be neither restored nor purged again.
    await PhotoAsset.updateOne({ assetId: "asset0" }, { $set: { purgeRequestedAt: new Date() } });
    const remaining = await (
      await list(new Request(`http://localhost/trash?spaceId=${spaceId}`))
    ).json();
    expect(remaining.items.map((item: { assetId: string }) => item.assetId)).toEqual(["asset"]);
  });
  it("authenticates retention cron and purges only expired trash", async () => {
    const f = await fixture();
    await changePhotoTrash({
      ...selection,
      now: new Date(Date.now() - 31 * 86400_000),
    });
    expect((await cron(new Request("http://localhost/cron"))).status).toBe(401);
    const response = await cron(
      new Request("http://localhost/cron", {
        headers: { authorization: "Bearer photo-test-cron" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: 1 });
    expect(
      await f.db.collection("storageobjects").findOne({ _id: f.objectId }),
    ).toBeNull();
  });
});
