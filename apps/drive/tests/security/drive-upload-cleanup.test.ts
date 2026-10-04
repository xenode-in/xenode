import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDriveUpload, DRIVE_CLEANUP_LEASE_MS, Space, withTransaction } from "@xenode/database";

const { deleteObjects, send } = vi.hoisted(() => ({ deleteObjects: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/b2/objects", () => ({ deleteObjects }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("@/lib/realtime/publish", () => ({
  publishSyncEvent: vi.fn(), toSyncObjectSnapshot: vi.fn(),
}));

import { GET } from "@/app/api/cron/cleanup-orphans/route";
import { POST as complete } from "@/app/api/objects/complete-upload/route";
import { getServerSession } from "@/lib/auth/session";
import { attachToUploadSession, reserveUploadSession, UPLOAD_SESSION_TTL_MS } from "@/lib/uploads/session";
import Bucket from "@/models/Bucket";
import UploadSession from "@/models/UploadSession";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";
import { createUsage, makeUserId } from "../helpers/factories";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function cronRequest(secret = "cleanup-lease-test") {
  return new NextRequest("http://localhost/api/cron/cleanup-orphans", { headers: { authorization: `Bearer ${secret}` } });
}

async function fixture(completed = false) {
  const userId = makeUserId();
  const spaceId = `space_personal_${userId}`;
  await Space.create({ _id: spaceId, type: "personal", ownerAccountId: userId, createdByAccountId: userId });
  const bucket = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" });
  const key = `users/${userId}/opaque`;
  const keys = [key, `${key}-thumb`, `${key}-optimized`];
  const upload = await UploadSession.create({
    userId, spaceId, bucketId: bucket._id, fileId: key, keys,
    status: completed ? "completed" : "pending",
    committedKeys: completed ? [key] : [],
    expiresAt: new Date(Date.now() - 60_000),
  });
  if (completed) {
    await StorageObject.create({
      _id: upload._id, productId: "drive", spaceId, createdByAccountId: userId,
      bucketId: bucket._id, key, size: 100, b2FileId: "existing",
    });
  }
  return { userId, spaceId, bucket, key, keys, upload };
}

function cleanup(input: Awaited<ReturnType<typeof fixture>>, now = new Date()) {
  return cleanupDriveUpload({
    sessionId: String(input.upload._id), now,
    deleteBlobs: async ({ bucketName, keys }) => { await deleteObjects(bucketName, keys); },
  });
}

describe("Drive cleanup leases and reconciliation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    deleteObjects.mockReset(); send.mockReset();
    process.env.CRON_SECRET = "cleanup-lease-test";
  });

  it("authenticates cron before claiming a ledger", async () => {
    const input = await fixture();
    expect((await GET(cronRequest("foreign-secret"))).status).toBe(401);
    expect((await UploadSession.findById(input.upload._id))?.status).toBe("pending");
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("allows one concurrent cleanup owner and removes the ledger only after confirmed B2 deletion", async () => {
    const input = await fixture();
    const started = deferred(); const finish = deferred();
    deleteObjects.mockImplementation(async () => { started.resolve(); await finish.promise; });
    const first = cleanup(input);
    await started.promise;
    const second = await cleanup(input);
    expect(second.status).toBe("skipped");
    expect((await UploadSession.findById(input.upload._id))?.status).toBe("cleaning");
    finish.resolve();
    expect((await first).status).toBe("deleted");
    expect(deleteObjects).toHaveBeenCalledOnce();
    expect(await UploadSession.findById(input.upload._id)).toBeNull();
  });

  it("keeps failed deletion retryable with a cooldown and then reclaims the exact keys", async () => {
    const input = await fixture();
    const now = new Date();
    deleteObjects.mockRejectedValueOnce(new Error("per-key delete failure"));
    expect((await cleanup(input, now)).status).toBe("retry");
    const failed = await UploadSession.findById(input.upload._id).lean();
    expect(failed).toMatchObject({ status: "cleaning", cleanupState: "cleaning", cleanupError: "cleanup_failed" });
    expect(failed?.cleanupLeaseId).toBeUndefined();
    expect((await cleanup(input, now)).status).toBe("skipped");
    expect((await cleanup(input, new Date(now.getTime() + 61_000))).status).toBe("deleted");
    expect(deleteObjects).toHaveBeenLastCalledWith(input.bucket.b2BucketId, input.keys);
  });

  it("reclaims an interrupted lease only after its expiry", async () => {
    const input = await fixture();
    const now = new Date();
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: {
      status: "cleaning", cleanupState: "cleaning", cleanupLeaseId: "interrupted",
      cleanupLeaseExpiresAt: new Date(now.getTime() + DRIVE_CLEANUP_LEASE_MS),
    } });
    expect((await cleanup(input, now)).status).toBe("skipped");
    expect((await cleanup(input, new Date(now.getTime() + DRIVE_CLEANUP_LEASE_MS + 1))).status).toBe("deleted");
    expect(deleteObjects).toHaveBeenCalledOnce();
  });

  it("does not let a stale cleanup owner retire another worker's lease", async () => {
    const input = await fixture();
    deleteObjects.mockImplementationOnce(async () => {
      await UploadSession.updateOne({ _id: input.upload._id }, { $set: {
        cleanupLeaseId: "replacement-worker", cleanupLeaseExpiresAt: new Date(Date.now() + DRIVE_CLEANUP_LEASE_MS),
      } });
    });
    expect((await cleanup(input)).status).toBe("skipped");
    expect((await UploadSession.findById(input.upload._id))?.cleanupLeaseId).toBe("replacement-worker");
  });

  it("removes only unused completed variants and keeps the object's permanent key claims", async () => {
    const input = await fixture(true);
    expect((await cleanup(input)).status).toBe("reconciled");
    expect(deleteObjects).toHaveBeenCalledWith(input.bucket.b2BucketId, input.keys.slice(1));
    const manifest = await UploadSession.findById(input.upload._id).lean();
    expect(manifest).toMatchObject({ status: "completed", cleanupState: "done", keys: input.keys, committedKeys: [input.key] });
    expect(await StorageObject.findById(input.upload._id)).not.toBeNull();
    expect((await cleanup(input)).status).toBe("skipped");
    expect(deleteObjects).toHaveBeenCalledOnce();
  });

  it("does not clean completed variants before their URL grace window has expired", async () => {
    const input = await fixture(true);
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: { expiresAt: new Date(Date.now() + 60_000) } });
    expect((await cleanup(input)).status).toBe("skipped");
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("marks fully used reservations reconciled without any B2 delete", async () => {
    const input = await fixture(true);
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: { committedKeys: input.keys } });
    expect((await cleanup(input)).status).toBe("reconciled");
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("quarantines malformed completed manifests without inventing deletion ownership", async () => {
    const input = await fixture(true);
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: { committedKeys: [] } });
    expect((await cleanup(input)).status).toBe("blocked");
    expect((await UploadSession.findById(input.upload._id))?.toObject()).toMatchObject({
      status: "completed", cleanupState: "blocked", cleanupError: "invalid_manifest",
    });
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("quarantines an unused variant referenced by another retained object", async () => {
    const input = await fixture(true);
    await StorageObject.create({
      productId: "photos", bucketId: input.bucket._id, spaceId: input.spaceId, createdByAccountId: input.userId,
      key: `${input.key}-photo`, thumbnail: input.keys[1], size: 1, b2FileId: "retained", deletedAt: new Date(),
    });
    expect((await cleanup(input)).status).toBe("blocked");
    expect(deleteObjects).not.toHaveBeenCalled();
    expect((await UploadSession.findById(input.upload._id))?.cleanupError).toBe("keys_referenced");
  });

  it("retains a completed manifest on deletion failure and reconciles it on retry", async () => {
    const input = await fixture(true);
    const now = new Date();
    deleteObjects.mockRejectedValueOnce(new Error("transport"));
    expect((await cleanup(input, now)).status).toBe("retry");
    expect((await UploadSession.findById(input.upload._id))?.status).toBe("completed");
    expect((await cleanup(input, new Date(now.getTime() + 61_000))).status).toBe("reconciled");
    expect(await StorageObject.findById(input.upload._id)).not.toBeNull();
  });

  it("lets renewed reservations outlive a stale cron cutoff", async () => {
    const input = await fixture();
    const cutoff = new Date(Date.now() + 60_000);
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: { expiresAt: new Date(Date.now() + 30_000) } });
    expect(await reserveUploadSession({
      userId: input.userId, spaceId: input.spaceId, bucketId: input.bucket._id,
      fileId: input.key, keys: input.keys, sessionId: String(input.upload._id),
    })).toBe(String(input.upload._id));
    expect((await cleanup(input, cutoff)).status).toBe("skipped");
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("renews the parent's grace whenever a variant URL is issued", async () => {
    const input = await fixture();
    const now = new Date();
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: { expiresAt: new Date(now.getTime() + 60_000) } });
    expect(await attachToUploadSession({
      userId: input.userId, spaceId: input.spaceId, bucketId: input.bucket._id,
      parentFileId: input.key, parentSessionId: String(input.upload._id), key: input.keys[1],
    })).toBe(String(input.upload._id));
    expect((await UploadSession.findById(input.upload._id))!.expiresAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + UPLOAD_SESSION_TTL_MS);
  });

  it("denies completion and reservation renewal after cleanup owns the claim", async () => {
    const input = await fixture();
    await createUsage({ userId: input.userId });
    await UploadSession.updateOne({ _id: input.upload._id }, { $set: { expiresAt: new Date(Date.now() + 60_000) } });
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: input.userId }, session: { id: "cleanup-session" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getServerSession>>>);
    const started = deferred(); const finish = deferred();
    deleteObjects.mockImplementation(async () => { started.resolve(); await finish.promise; });
    const work = cleanup(input, new Date(Date.now() + 120_000));
    await started.promise;
    try {
      const response = await complete(new NextRequest("http://localhost/api/objects/complete-upload", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          objectKey: input.key, bucketId: String(input.bucket._id), sessionId: String(input.upload._id),
          size: 100, isEncrypted: true, encryptedDEK: "wrapped-key", encryptedName: "encrypted-name",
        }),
      }));
      expect(response.status).toBe(409);
      expect(await reserveUploadSession({
        userId: input.userId, spaceId: input.spaceId, bucketId: input.bucket._id,
        fileId: input.key, keys: input.keys, sessionId: String(input.upload._id),
      })).toBeNull();
      expect(send).not.toHaveBeenCalled();
      expect(await StorageObject.countDocuments({})).toBe(0);
      expect((await Usage.findOne({ userId: input.userId }))?.totalStorageBytes).toBe(0);
    } finally { finish.resolve(); }
    expect((await work).status).toBe("deleted");
  });

  it("cannot claim a transaction's completed upload after reading its old pending state", async () => {
    const input = await fixture();
    const claimed = deferred(); const finish = deferred(); const cleanupStarted = deferred();
    const transaction = withTransaction(async (session) => {
      await UploadSession.updateOne({ _id: input.upload._id }, { $set: { status: "completing" } }, { session });
      claimed.resolve();
      await finish.promise;
      await StorageObject.create([{
        _id: input.upload._id, bucketId: input.bucket._id, spaceId: input.spaceId, createdByAccountId: input.userId,
        key: input.key, size: 100, b2FileId: "committed",
      }], { session });
      await UploadSession.updateOne({ _id: input.upload._id }, {
        $set: { status: "completed", committedKeys: input.keys },
      }, { session });
    });
    await claimed.promise;
    const original = UploadSession.collection.findOneAndUpdate.bind(UploadSession.collection);
    const spy = vi.spyOn(UploadSession.collection, "findOneAndUpdate").mockImplementation((...args) => {
      cleanupStarted.resolve();
      return original(...args);
    });
    const work = cleanup(input);
    try {
      await cleanupStarted.promise;
    } finally { finish.resolve(); }
    await transaction;
    expect((await work).status).toBe("skipped");
    spy.mockRestore();
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(await StorageObject.findById(input.upload._id)).not.toBeNull();
    expect((await UploadSession.findById(input.upload._id))?.status).toBe("completed");
  });

  it("bounds a cron run to 100 manifests and leaves the rest for another request", async () => {
    const input = await fixture();
    await UploadSession.insertMany(Array.from({ length: 100 }, (_, index) => ({
      userId: input.userId, spaceId: input.spaceId, bucketId: input.bucket._id,
      fileId: `${input.key}-${index}`, keys: [`${input.key}-${index}`],
      expiresAt: input.upload.expiresAt,
    })));
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).scanned).toBe(100);
    expect(await UploadSession.countDocuments({})).toBe(1);
    expect(deleteObjects).toHaveBeenCalledTimes(100);
  });
});
