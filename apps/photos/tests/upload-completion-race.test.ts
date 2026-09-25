import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  PhotoAsset,
  connectDatabase,
  disconnectDatabaseForTests,
  getDatabase,
  getMongoose,
} from "@xenode/database";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  storage: vi.fn(),
  resolveAccess: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getPhotosProductSession: mocks.session }));
vi.mock("@/lib/storage-server", () => ({ getPhotosStorageContext: mocks.storage }));
vi.mock("@xenode/spaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xenode/spaces")>()),
  resolveSpaceAccess: mocks.resolveAccess,
}));

import { POST as complete } from "../app/api/photos/uploads/complete/route";
import { POST as abort } from "../app/api/photos/uploads/abort/route";

const accountId = "photos-race-account";
const spaceId = `space_personal_${accountId}`;
const priorUri = process.env.MONGODB_URI;
let server: MongoMemoryReplSet;
let bucketId: InstanceType<ReturnType<typeof getMongoose>["Types"]["ObjectId"]>;

function variantKey(hex: string) {
  return `users/${accountId}/${hex.repeat(32)}`;
}

function body(assetId = "same-asset") {
  return {
    assetId,
    bucketId: bucketId.toString(),
    mediaType: "image",
    takenAt: "2026-09-25T00:00:00.000Z",
    objectKey: variantKey("a"),
    size: 100,
    originalContentType: "image/png",
    encryptedDEK: "wrapped-original",
    iv: "iv-original",
    spaceKeyWrapIv: "wrap-original",
    optimizedKey: variantKey("b"),
    optimizedSize: 100,
    optimizedContentType: "image/jpeg",
    optimizedEncryptedDEK: "wrapped-optimized",
    optimizedIV: "iv-optimized",
    optimizedSpaceKeyWrapIv: "wrap-optimized",
    thumbnailKey: variantKey("c"),
    thumbnailSize: 100,
    thumbnailContentType: "image/jpeg",
    thumbnailEncryptedDEK: "wrapped-thumbnail",
    thumbnailIV: "iv-thumbnail",
    thumbnailSpaceKeyWrapIv: "wrap-thumbnail",
  };
}

function request(path: string, value: object) {
  return new Request(`https://photos.example.test/api/photos/uploads/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  await connectDatabase();
  await PhotoAsset.init();
  await getDatabase().collection("storageobjects").createIndex(
    { bucketId: 1, key: 1 }, { unique: true },
  );
});

beforeEach(async () => {
  vi.clearAllMocks();
  bucketId = new (getMongoose().Types.ObjectId)();
  mocks.session.mockResolvedValue({ accountId });
  mocks.resolveAccess.mockResolvedValue({ role: "owner" });
  mocks.storage.mockResolvedValue({
    bucket: { _id: bucketId, b2BucketId: "photos-test-bucket" },
    client: { send: mocks.send },
  });
  mocks.send.mockResolvedValue({ ContentLength: 100, VersionId: "test-version" });
  await getDatabase().collection("buckets").insertOne({
    _id: bucketId, b2BucketId: "photos-test-bucket",
    objectCount: 0, totalSizeBytes: 0,
  });
  await getDatabase().collection("usages").insertOne({
    userId: accountId, totalStorageBytes: 0, totalObjects: 0,
    uploadCount: 0, storageLimitBytes: 1_000_000,
  });
});

afterEach(async () => {
  for (const collection of await getDatabase().collections()) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (priorUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = priorUri;
});

describe("Photos completion race safety", () => {
  it("keeps the winning asset when another completion loses its unique ID", async () => {
    let releaseHeads!: () => void;
    const held = new Promise<void>((resolve) => { releaseHeads = resolve; });
    let reachedHeads!: () => void;
    const headsStarted = new Promise<void>((resolve) => { reachedHeads = resolve; });
    let headCount = 0;
    mocks.send.mockImplementation(async () => {
      headCount++;
      if (headCount === 3) reachedHeads();
      await held;
      return { ContentLength: 100, VersionId: "test-version" };
    });

    const pending = complete(request("complete", body()));
    await headsStarted;
    const winnerId = new (getMongoose().Types.ObjectId)();
    await getDatabase().collection("storageobjects").insertOne({
      _id: winnerId, productId: "photos", bucketId, spaceId,
      createdByAccountId: accountId, key: variantKey("d"),
    });
    await PhotoAsset.create({
      assetId: "same-asset", spaceId, storageObjectId: winnerId.toString(),
      mediaType: "image", takenAt: new Date(), uploadSource: "web",
      createdByAccountId: accountId,
    });
    releaseHeads();
    expect((await pending).status).toBe(500);

    expect(await PhotoAsset.findOne({ assetId: "same-asset" }).lean()).toMatchObject({
      storageObjectId: winnerId.toString(),
    });
    expect(await getDatabase().collection("storageobjects").countDocuments({
      _id: winnerId,
    })).toBe(1);
    expect(await getDatabase().collection("storageobjects").countDocuments({
      key: body().objectKey,
    })).toBe(0);
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(0);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it("returns an already completed asset without deleting alternate ciphertext", async () => {
    const winnerId = new (getMongoose().Types.ObjectId)();
    await PhotoAsset.create({
      assetId: "same-asset", spaceId, storageObjectId: winnerId.toString(),
      mediaType: "image", takenAt: new Date(), uploadSource: "web",
      createdByAccountId: accountId,
    });
    const response = await complete(request("complete", body()));
    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retains uncertain blobs when a reported upload size is wrong", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 99, VersionId: "test-version" });
    const response = await complete(request("complete", body("mismatched-asset")));
    expect(response.status).toBe(400);
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(await getDatabase().collection("storageobjects").countDocuments({})).toBe(0);
  });

  it("cannot abort arbitrary Drive keys from the shared bucket", async () => {
    const response = await abort(request("abort", {
      bucketId: bucketId.toString(), objectKeys: [variantKey("d")],
    }));
    expect(response.status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
