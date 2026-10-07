import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  PhotoAlbumV2,
  PhotoAsset,
  connectDatabase,
  disconnectDatabaseForTests,
  getDatabase,
  getMongoose,
} from "@xenode/database";

const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), storage: vi.fn() }));
vi.mock("@/lib/session", () => ({ getPhotosProductSession: mocks.session }));
vi.mock("@/lib/storage-server", () => ({ getPhotosStorageContext: mocks.storage }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://r2.test/signed" }));
vi.mock("@xenode/spaces", async (original) => ({
  ...(await original<typeof import("@xenode/spaces")>()),
  resolveSpaceAccess: mocks.access,
}));
import { SpaceAuthorizationError } from "@xenode/spaces";
import { GET as listAlbums } from "../app/api/photos/albums/route";
import { GET as albumPage } from "../app/api/photos/albums/[albumId]/route";
import { GET as content } from "../app/api/photos/assets/[assetId]/content/route";

const owner = "album-owner";
const spaceId = `space_personal_${owner}`;
let server: MongoMemoryReplSet;
const oldUri = process.env.MONGODB_URI;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  await connectDatabase();
  await Promise.all([PhotoAsset.init(), PhotoAlbumV2.init()]);
});
afterAll(async () => {
  await disconnectDatabaseForTests();
  await server.stop();
  if (oldUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = oldUri;
});
beforeEach(() => {
  mocks.session.mockResolvedValue({ accountId: owner, expiresAt: new Date(Date.now() + 3_600_000) });
  mocks.access.mockResolvedValue({ role: "owner" });
});
afterEach(async () => {
  for (const name of await getDatabase().listCollections().toArray()) {
    await getDatabase().collection(name.name).deleteMany({});
  }
});

const get = (path: string) => new Request(`http://localhost/api/photos/${path}`);
async function photo(assetId: string, space = spaceId, status: "active" | "trashed" = "active") {
  await PhotoAsset.create({
    assetId, spaceId: space, status, mediaType: "image", takenAt: new Date(),
    uploadSource: "web", createdByAccountId: owner,
    storageObjectId: String(new (getMongoose().Types.ObjectId)()),
  });
}
async function album(albumId: string, photoAssetIds: string[], updatedAt: Date, extra = {}) {
  await PhotoAlbumV2.collection.insertOne({
    albumId, spaceId, encryptedName: `sealed-${albumId}`, photoAssetIds,
    createdByAccountId: owner, createdAt: updatedAt, updatedAt, ...extra,
  });
}

describe("Photos album pages", () => {
  it("lists newest albums first with counts and covers, never member ids", async () => {
    await album("old", ["x1"], new Date("2026-01-01"));
    await album("mid", ["x2", "x3"], new Date("2026-02-01"), { coverPhotoAssetId: "x3" });
    await album("new", [], new Date("2026-03-01"));
    await PhotoAlbumV2.collection.insertOne({
      albumId: "foreign", spaceId: "space_personal_other", encryptedName: "sealed",
      photoAssetIds: [], createdByAccountId: "other", updatedAt: new Date("2026-04-01"),
    });

    const first = await (await listAlbums(get(`albums?spaceId=${spaceId}&limit=2`))).json();
    expect(first.albums).toEqual([
      { albumId: "new", encryptedName: "sealed-new", photoAssetCount: 0 },
      { albumId: "mid", encryptedName: "sealed-mid", photoAssetCount: 2, coverPhotoAssetId: "x3" },
    ]);
    const second = await (await listAlbums(get(`albums?spaceId=${spaceId}&limit=2&cursor=${first.nextCursor}`))).json();
    expect(second).toEqual({
      albums: [{ albumId: "old", encryptedName: "sealed-old", photoAssetCount: 1, coverPhotoAssetId: "x1" }],
      nextCursor: null,
    });
    expect((await listAlbums(get(`albums?spaceId=${spaceId}&cursor=bad`))).status).toBe(400);
    expect((await listAlbums(get(`albums?spaceId=${spaceId}&limit=0`))).status).toBe(400);
  });

  it("pages an album's active photos in album order within the Space", async () => {
    await Promise.all([photo("a1"), photo("a2"), photo("a3"), photo("t1", spaceId, "trashed"), photo("f1", "space_personal_other")]);
    await album("trip", ["a3", "a1", "t1", "f1", "a2"], new Date());
    const page = (cursor = "") =>
      albumPage(get(`albums/trip?spaceId=${spaceId}&limit=2${cursor && `&cursor=${cursor}`}`), {
        params: Promise.resolve({ albumId: "trip" }),
      });

    const first = await (await page()).json();
    expect(first.items.map((item: { assetId: string }) => item.assetId)).toEqual(["a3", "a1"]);
    expect(first.nextCursor).toBe("2");
    const second = await (await page("2")).json(); // trashed and foreign members are skipped
    expect(second).toMatchObject({ items: [], nextCursor: "4" });
    const third = await (await page("4")).json();
    expect(third.items.map((item: { assetId: string }) => item.assetId)).toEqual(["a2"]);
    expect(third.nextCursor).toBeNull();

    expect((await page("-1")).status).toBe(400);
    const missing = await albumPage(get(`albums/nope?spaceId=${spaceId}`), { params: Promise.resolve({ albumId: "nope" }) });
    expect(missing.status).toBe(404);
    mocks.access.mockRejectedValueOnce(new SpaceAuthorizationError(404, "space_not_found", "Space not found"));
    expect((await page()).status).toBe(404);
  });
});

describe("trashed photo previews", () => {
  it("serves a trashed photo only when asked, and never once purge is requested", async () => {
    const ObjectId = getMongoose().Types.ObjectId;
    const objectId = new ObjectId(), bucketId = new ObjectId();
    mocks.storage.mockResolvedValue({ client: {}, bucket: { _id: bucketId, b2BucketId: "photo-bucket" } });
    await PhotoAsset.create({
      assetId: "binned", spaceId, status: "trashed", trashedAt: new Date(), mediaType: "image",
      takenAt: new Date(), uploadSource: "web", createdByAccountId: owner, storageObjectId: String(objectId),
    });
    await getDatabase().collection("storageobjects").insertOne({
      _id: objectId, bucketId, spaceId, productId: "photos", createdByAccountId: owner, isEncrypted: true,
      deletedAt: new Date(), key: "users/album-owner/binned", encryptedDEK: "wrapped", iv: "iv", spaceKeyWrapIv: "wrap-iv",
    });
    const read = (query: string) =>
      content(get(`assets/binned/content?variant=thumbnail${query}`), { params: Promise.resolve({ assetId: "binned" }) });

    expect((await read("")).status).toBe(404);
    const trashed = await read("&state=trashed");
    expect(trashed.status).toBe(200);
    expect((await trashed.json()).objectKey).toBe("users/album-owner/binned");

    await PhotoAsset.updateOne({ assetId: "binned" }, { $set: { purgeRequestedAt: new Date() } });
    expect((await read("&state=trashed")).status).toBe(404);
  });

  it("describes a chunked video original's layout so it can stream", async () => {
    const ObjectId = getMongoose().Types.ObjectId;
    const objectId = new ObjectId(), bucketId = new ObjectId();
    mocks.storage.mockResolvedValue({ client: {}, bucket: { _id: bucketId, b2BucketId: "photo-bucket" } });
    await PhotoAsset.create({
      assetId: "clip", spaceId, status: "active", mediaType: "video",
      takenAt: new Date(), uploadSource: "web", createdByAccountId: owner, storageObjectId: String(objectId),
    });
    await getDatabase().collection("storageobjects").insertOne({
      _id: objectId, bucketId, spaceId, productId: "photos", createdByAccountId: owner, isEncrypted: true,
      key: "users/album-owner/clip", size: 116, encryptedDEK: "wrapped", iv: "A".repeat(16), spaceKeyWrapIv: "wrap-iv",
      originalContentType: "video/mp4", chunkSize: 1_048_576, chunkCount: 1, chunkIvs: JSON.stringify(["A".repeat(16)]),
    });
    const read = (variant: string) =>
      content(get(`assets/clip/content?variant=${variant}`), { params: Promise.resolve({ assetId: "clip" }) });
    expect(await (await read("original")).json()).toMatchObject({
      size: 116, chunkSize: 1_048_576, chunkIvs: ["A".repeat(16)], contentType: "video/mp4",
    });
  });
});
