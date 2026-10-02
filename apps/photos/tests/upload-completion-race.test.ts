import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { DeleteObjectsCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  PhotoAsset,
  PhotoUpload,
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
  sign: vi.fn(),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
vi.mock("@/lib/session", () => ({ getPhotosProductSession: mocks.session }));
vi.mock("@/lib/storage-server", () => ({ getPhotosStorageContext: mocks.storage }));
vi.mock("@xenode/spaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xenode/spaces")>()),
  resolveSpaceAccess: mocks.resolveAccess,
}));

import { POST as complete } from "../app/api/photos/uploads/complete/route";
import { POST as abort } from "../app/api/photos/uploads/abort/route";
import { cleanupPhotoUpload } from "../lib/upload-cleanup";
import { POST as presign } from "../app/api/photos/uploads/presign/route";
import { GET as cleanup } from "../app/api/cron/cleanup-photo-uploads/route";

const accountId = "photos-race-account";
const spaceId = `space_personal_${accountId}`;
const priorUri = process.env.MONGODB_URI;
const priorCronSecret = process.env.CRON_SECRET;
const cronSecret = "synthetic-photo-cleanup-secret";
let server: MongoMemoryReplSet;
let bucketId: InstanceType<ReturnType<typeof getMongoose>["Types"]["ObjectId"]>;

function variantKey(hex: string) {
  return `users/${accountId}/${hex.repeat(32)}`;
}

function body(assetId = "same-asset") {
  return {
    uploadId: `upload-${assetId}`,
    assetId,
    bucketId: bucketId.toString(),
    mediaType: "image" as const,
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

async function reserve(value: ReturnType<typeof body>) {
  return PhotoUpload.create({
    uploadId: value.uploadId,
    assetId: value.assetId,
    accountId,
    spaceId,
    bucketId,
    mediaType: value.mediaType,
    original: { key: value.objectKey, size: value.size },
    optimized: { key: value.optimizedKey, size: value.optimizedSize },
    thumbnail: { key: value.thumbnailKey, size: value.thumbnailSize },
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  });
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
  await PhotoUpload.init();
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
  const deletedKeys = new Set<string>();
  mocks.send.mockReset();
  mocks.send.mockImplementation(async (command) => {
    if (command instanceof DeleteObjectsCommand) {
      for (const entry of command.input.Delete?.Objects ?? []) deletedKeys.add(entry.Key!);
      return {};
    }
    if (command instanceof HeadObjectCommand && deletedKeys.has(command.input.Key!)) {
      throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
    }
    return { ContentLength: 100, VersionId: "test-version" };
  });
  mocks.sign.mockResolvedValue("https://upload.example.test/signed");
  process.env.CRON_SECRET = cronSecret;
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
  if (priorCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = priorCronSecret;
});

describe("Photos completion race safety", () => {
  it("keeps the winning asset when another completion loses its unique ID", async () => {
    await reserve(body());
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
    expect((await pending).status).toBe(409);

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
    expect((await PhotoUpload.findOne({ uploadId: body().uploadId }))?.status).toBe("pending");
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it("returns the completed manifest asset on a response-lost retry", async () => {
    const upload = body();
    await reserve(upload);
    expect((await complete(request("complete", upload))).status).toBe(201);
    mocks.send.mockClear();
    const response = await complete(request("complete", upload));
    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(300);
    expect(usage?.uploadCount).toBe(1);
  });

  it("retains uncertain blobs when a reported upload size is wrong", async () => {
    await reserve(body("mismatched-asset"));
    mocks.send.mockResolvedValue({ ContentLength: 99, VersionId: "test-version" });
    const response = await complete(request("complete", body("mismatched-asset")));
    expect(response.status).toBe(400);
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(await getDatabase().collection("storageobjects").countDocuments({})).toBe(0);
  });

  it("rejects a key that is not in the server-issued manifest", async () => {
    const upload = body("manifest-mismatch");
    await reserve(upload);
    const response = await complete(request("complete", {
      ...upload, objectKey: variantKey("d"),
    }));
    expect(response.status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("queues only server-manifested keys and deletes them after URL expiry", async () => {
    await reserve(body());
    await getDatabase().collection("storageobjects").insertOne({
      productId: "drive", bucketId, spaceId,
      createdByAccountId: accountId, key: variantKey("d"),
    });
    const response = await abort(request("abort", {
      uploadId: body().uploadId, objectKeys: [variantKey("d")],
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ cancelled: true, cleanupPending: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await PhotoUpload.findOne({ uploadId: body().uploadId }))?.status).toBe("aborting");
    await PhotoUpload.updateOne({ uploadId: body().uploadId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await cleanup(cronRequest())).status).toBe(200);
    const deleted = mocks.send.mock.calls[0][0].input.Delete.Objects;
    expect(deleted.map((entry: { Key: string }) => entry.Key).sort()).toEqual([
      body().objectKey, body().optimizedKey, body().thumbnailKey,
    ].sort());
    expect(deleted).not.toContainEqual({ Key: variantKey("d") });
    expect(await PhotoUpload.countDocuments({ uploadId: body().uploadId })).toBe(0);
  });

  it("reserves stable variant keys for an asset before signing URLs", async () => {
    const requestBody = {
      assetId: "presign-asset", fileSize: 100, mediaType: "image/png",
      optimizedSize: 100, thumbnailSize: 100,
    };
    const [first, second] = await Promise.all([
      presign(request("presign", requestBody)),
      presign(request("presign", requestBody)),
    ]);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.uploadId).toBeTruthy();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.uploadId).toBe(firstBody.uploadId);
    expect(secondBody.original.objectKey).toBe(firstBody.original.objectKey);
    expect(await PhotoUpload.countDocuments({ assetId: requestBody.assetId })).toBe(1);
    expect(mocks.sign).toHaveBeenCalledTimes(6);
    for (const [, command] of mocks.sign.mock.calls) {
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect((command as PutObjectCommand).input.IfNoneMatch).toBe("*");
    }
    await PhotoUpload.updateOne({ uploadId: firstBody.uploadId }, {
      $set: { expiresAt: new Date(Date.now() + 10_000) },
    });
    expect((await presign(request("presign", requestBody))).status).toBe(200);
    const renewed = await PhotoUpload.findOne({ uploadId: firstBody.uploadId }).lean();
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it("completes a manifest once and refuses to abort its stored ciphertext", async () => {
    const upload = body("successful-asset");
    await reserve(upload);
    const response = await complete(request("complete", upload));
    expect(response.status).toBe(201);
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.status).toBe("completed");
    expect(await PhotoAsset.countDocuments({ assetId: upload.assetId })).toBe(1);
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(300);
    expect((await abort(request("abort", { uploadId: upload.uploadId }))).status).toBe(409);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it("permits only one database finalization for concurrent completion", async () => {
    const upload = body("concurrent-asset");
    await reserve(upload);
    const responses = await Promise.all([
      complete(request("complete", upload)),
      complete(request("complete", upload)),
    ]);
    expect(responses.some((response) => response.status === 201)).toBe(true);
    expect(responses.every((response) => [200, 201, 409].includes(response.status))).toBe(true);
    expect(await PhotoAsset.countDocuments({ assetId: upload.assetId })).toBe(1);
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(300);
    expect(usage?.uploadCount).toBe(1);
  });

  it("aborts all finalization writes when quota is exhausted", async () => {
    const upload = body("quota-rejection");
    await reserve(upload);
    await getDatabase().collection("usages").updateOne({ userId: accountId }, {
      $set: { storageLimitBytes: 200 },
    });
    expect((await complete(request("complete", upload))).status).toBe(402);
    expect(await PhotoAsset.countDocuments({})).toBe(0);
    expect(await getDatabase().collection("storageobjects").countDocuments({})).toBe(0);
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.status).toBe("pending");
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(0);
    expect(usage?.uploadCount).toBe(0);
  });

  it("rolls back usage and metadata when bucket metadata disappears before commit", async () => {
    const upload = body("missing-bucket");
    await reserve(upload);
    await getDatabase().collection("buckets").deleteOne({ _id: bucketId });
    expect((await complete(request("complete", upload))).status).toBe(409);
    expect(await PhotoAsset.countDocuments({})).toBe(0);
    expect(await getDatabase().collection("storageobjects").countDocuments({})).toBe(0);
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.status).toBe("pending");
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(0);
    expect(usage?.totalObjects).toBe(0);
  });

  it("does not finalize after abort wins while B2 verification is in flight", async () => {
    const upload = body("abort-before-commit");
    await reserve(upload);
    let releaseHeads!: () => void;
    const held = new Promise<void>((resolve) => { releaseHeads = resolve; });
    let reachedHeads!: () => void;
    const started = new Promise<void>((resolve) => { reachedHeads = resolve; });
    let headCount = 0;
    mocks.send.mockImplementation(async (command) => {
      if (command.input.Delete) return {};
      headCount++;
      if (headCount === 3) reachedHeads();
      await held;
      return { ContentLength: 100, VersionId: "test-version" };
    });
    const pending = complete(request("complete", upload));
    await started;
    expect((await abort(request("abort", { uploadId: upload.uploadId }))).status).toBe(202);
    releaseHeads();
    expect((await pending).status).toBe(409);
    expect(await PhotoAsset.countDocuments({ assetId: upload.assetId })).toBe(0);
    const usage = await getDatabase().collection("usages").findOne({ userId: accountId });
    expect(usage?.totalStorageBytes).toBe(0);
  });

  function cronRequest(authorized = true) {
    return new Request("https://photos.example.test/api/cron/cleanup-photo-uploads", {
      headers: authorized ? { authorization: `Bearer ${cronSecret}` } : {},
    });
  }

  it("authenticates the Photos cleanup cron before storage work", async () => {
    expect((await cleanup(cronRequest(false))).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("queues concurrent client abort idempotently without deleting live PUT keys", async () => {
    const upload = body("abort-race");
    await reserve(upload);
    const responses = await Promise.all([
      abort(request("abort", { uploadId: upload.uploadId })),
      abort(request("abort", { uploadId: upload.uploadId })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.status).toBe("aborting");
    const renewed = await presign(request("presign", {
      assetId: upload.assetId, fileSize: upload.size, mediaType: "image/png",
      optimizedSize: upload.optimizedSize, thumbnailSize: upload.thumbnailSize,
    }));
    expect(renewed.status).toBe(409);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("deletes exact expired manifest keys before removing the ledger", async () => {
    const upload = body("expired-asset");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, {
      $set: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await cleanup(cronRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(1);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(0);
    const keys = mocks.send.mock.calls[0][0].input.Delete.Objects.map(
      (entry: { Key: string }) => entry.Key,
    );
    expect(keys.sort()).toEqual([upload.objectKey, upload.optimizedKey, upload.thumbnailKey].sort());
  });

  it("blocks cleanup when any product still references a claimed key", async () => {
    const upload = body("referenced-asset");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, {
      $set: { expiresAt: new Date(Date.now() - 1000) },
    });
    await getDatabase().collection("storageobjects").insertOne({
      bucketId, productId: "drive", key: upload.objectKey,
    });
    const response = await cleanup(cronRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).blocked).toBe(1);
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.status).toBe("blocked");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retains a retryable manifest after per-key B2 deletion failure", async () => {
    const upload = body("failed-cleanup");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, {
      $set: { expiresAt: new Date(Date.now() - 1000) },
    });
    mocks.send.mockResolvedValueOnce({ Errors: [{ Key: upload.objectKey, Code: "InternalError" }] });
    expect((await cleanup(cronRequest())).status).toBe(500);
    const retained = await PhotoUpload.findOne({ uploadId: upload.uploadId }).lean();
    expect(retained?.status).toBe("aborting");
    expect(retained?.cleanupLeaseId).toBeUndefined();
    expect(retained?.cleanupError).toBe("cleanup_failed");
    expect((await cleanup(cronRequest())).status).toBe(200);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(1);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: { cleanupNextAttemptAt: new Date(0) } });
    expect((await cleanup(cronRequest())).status).toBe(200);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(0);
  });

  it("waits until the signed-URL grace expires before the first physical delete", async () => {
    const upload = body("aborted-recheck");
    await reserve(upload);
    expect((await abort(request("abort", { uploadId: upload.uploadId }))).status).toBe(202);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(1);
    const early = await cleanup(cronRequest());
    expect((await early.json()).scanned).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, {
      $set: { expiresAt: new Date(Date.now() - 1000) },
    });
    mocks.send.mockClear();
    expect((await cleanup(cronRequest())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(4);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(0);
  });

  it("does not let a future cleanup cutoff bypass the current PUT expiry", async () => {
    const upload = body("future-cutoff");
    await reserve(upload);
    const result = await cleanupPhotoUpload({ uploadId: upload.uploadId, accountId, spaceId,
      expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    expect(result.status).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.status).toBe("pending");
  });

  it.each(["present", "forbidden"])("retains the manifest when post-delete HEAD is %s", async (kind) => {
    const upload = body("head-unconfirmed");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: { expiresAt: new Date(0) } });
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) return {};
      if (kind === "forbidden") throw { name: "AccessDenied", $metadata: { httpStatusCode: 403 } };
      return {};
    });
    expect((await cleanup(cronRequest())).status).toBe(500);
    const retained = await PhotoUpload.findOne({ uploadId: upload.uploadId }).lean();
    expect(retained).toMatchObject({ status: "aborting", cleanupError: "cleanup_failed" });
    expect(retained?.cleanupLeaseId).toBeUndefined();
  });

  it("allows one cron worker to own deletion while another sees the live lease", async () => {
    const upload = body("cleanup-lease-race");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: { expiresAt: new Date(0) } });
    let release!: () => void, started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const deleting = new Promise<void>((resolve) => { started = resolve; });
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) { started(); await held; return {}; }
      throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
    });
    const first = cleanup(cronRequest());
    await deleting;
    try {
      const second = await cleanup(cronRequest());
      expect((await second.json()).scanned).toBe(0);
    } finally { release(); }
    expect((await first).status).toBe(200);
    expect(mocks.send.mock.calls.filter(([command]) => command instanceof DeleteObjectsCommand)).toHaveLength(1);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(0);
  });

  it("recovers an expired cleanup lease without retiring a live one", async () => {
    const upload = body("interrupted-cleanup");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: {
      status: "aborting", expiresAt: new Date(0), cleanupLeaseId: "interrupted",
      cleanupLeaseExpiresAt: new Date(Date.now() + 60_000),
    } });
    expect((await (await cleanup(cronRequest())).json()).scanned).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: { cleanupLeaseExpiresAt: new Date(0) } });
    expect((await cleanup(cronRequest())).status).toBe(200);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(0);
  });

  it("does not let a stale cleanup worker retire a replacement lease", async () => {
    const upload = body("replaced-cleanup-lease");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: { expiresAt: new Date(0) } });
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) {
        await PhotoUpload.updateOne({ uploadId: upload.uploadId }, { $set: {
          cleanupLeaseId: "replacement", cleanupLeaseExpiresAt: new Date(Date.now() + 60_000),
        } });
        return {};
      }
      throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
    });
    const response = await cleanup(cronRequest());
    expect((await response.json()).unavailable).toBe(1);
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.cleanupLeaseId).toBe("replacement");
  });

  it.each(["foreign-owner", "missing-derivative"])("blocks a %s manifest before storage deletion", async (kind) => {
    const upload = body("invalid-cleanup-manifest");
    await reserve(upload);
    await getDatabase().collection("photoUploads").updateOne({ uploadId: upload.uploadId }, { $set: {
      expiresAt: new Date(0), ...(kind === "foreign-owner"
        ? { "original.key": `users/other-account/${"a".repeat(32)}` }
        : { "optimized.key": null }),
    } });
    const response = await cleanup(cronRequest());
    expect((await response.json()).blocked).toBe(1);
    expect((await PhotoUpload.findOne({ uploadId: upload.uploadId }))?.cleanupError).toBe("invalid_manifest");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not delete an interrupted completion claim", async () => {
    const upload = body("interrupted-completion");
    await reserve(upload);
    await PhotoUpload.updateOne({ uploadId: upload.uploadId }, {
      $set: { status: "completing", expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await cleanup(cronRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).scanned).toBe(0);
    expect(await PhotoUpload.countDocuments({ uploadId: upload.uploadId })).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
