import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/b2/client", () => ({
  getS3Client: () => ({ send }),
}));

import { POST } from "@/app/api/objects/complete-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import Usage from "@/models/Usage";
import { createUsage, makeUserId } from "../helpers/factories";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId: string) {
  mockedGetServerSession.mockResolvedValue({
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: `session-${userId}`,
      userId,
      token: `token-${userId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/objects/complete-upload", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function createBucket(userId: string, suffix: string) {
  void userId;
  void suffix;
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
    { upsert: true, new: true },
  );
  return bucket!;
}

async function encryptedUpload(userId: string, bucketId: string) {
  const body = {
    objectKey: `users/${userId}/original`,
    optimizedKey: `users/${userId}/optimized`,
    thumbnail: `users/${userId}/thumbnail`,
    bucketId,
    size: 1_000,
    contentType: "application/octet-stream",
    originalContentType: "image/jpeg",
    isEncrypted: true,
    encryptedDEK: "wrapped-key",
    iv: "iv",
    encryptedName: "encrypted-name",
    encryptedMetadata: "encrypted-metadata",
    syncContentFp: "content-fingerprint",
    syncMetaFp: "meta-fingerprint",
  };
  const reservation = await UploadSession.create({
    userId,
    spaceId: `space_personal_${userId}`,
    bucketId,
    fileId: body.objectKey,
    keys: [body.objectKey, body.optimizedKey, body.thumbnail],
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { ...body, sessionId: String(reservation._id) };
}

describe("photo backup complete-upload finalization", () => {
  beforeEach(() => send.mockReset());
  it("leaves all database writes unchanged and blobs reserved when quota rejects finalization", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "quota");
    await createUsage({
      userId,
      totalStorageBytes: 500,
      storageLimitBytes: 500,
    });
    send.mockResolvedValue({ ContentLength: 1_000 });

    const body = await encryptedUpload(userId, String(bucket._id));
    const response = await POST(request(body));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Storage quota exceeded",
      code: "storage_quota_exceeded",
    });
    expect(await StorageObject.countDocuments({ bucketId: bucket._id })).toBe(0);

    expect(send.mock.calls).toHaveLength(3);
    expect(send.mock.calls.every(([command]) => command instanceof HeadObjectCommand)).toBe(true);
    expect((await UploadSession.findById(body.sessionId))?.status).toBe("pending");
    expect((await Usage.findOne({ userId }))?.totalStorageBytes).toBe(500);
    expect((await Bucket.findById(bucket._id))?.objectCount).toBe(0);
  });

  it("does not allow generic completion to overwrite an existing object", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "existing-quota");
    const body = await encryptedUpload(userId, String(bucket._id));
    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: `space_personal_${userId}`,
      createdByAccountId: userId,
      key: body.objectKey,
      size: 500,
      contentType: "image/jpeg",
      b2FileId: "existing",
      isEncrypted: true,
    });
    await createUsage({
      userId,
      totalStorageBytes: 500,
      storageLimitBytes: 500,
    });
    await Usage.updateOne({ userId }, { $set: { totalObjects: 1, uploadCount: 1 } });
    send.mockResolvedValue({});

    const response = await POST(request(body));

    expect(response.status).toBe(409);
    const existing = await StorageObject.findOne({ key: body.objectKey });
    const usage = await Usage.findOne({ userId });
    expect(existing?.size).toBe(500);
    expect(usage?.totalStorageBytes).toBe(500);
    expect(usage?.totalObjects).toBe(1);
    expect(usage?.uploadCount).toBe(1);
  });

  it("leaves billing unchanged when generic completion targets an existing object", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "existing-resize");
    const body = await encryptedUpload(userId, String(bucket._id));
    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: `space_personal_${userId}`,
      createdByAccountId: userId,
      key: body.objectKey,
      size: 500,
      contentType: "image/jpeg",
      b2FileId: "existing",
      isEncrypted: true,
    });
    await createUsage({
      userId,
      totalStorageBytes: 500,
      storageLimitBytes: 2_000,
    });
    await Usage.updateOne({ userId }, { $set: { totalObjects: 1, uploadCount: 1 } });
    send.mockResolvedValue({});

    const response = await POST(request(body));

    expect(response.status).toBe(409);
    const usage = await Usage.findOne({ userId });
    expect(usage?.totalStorageBytes).toBe(500);
    expect(usage?.totalObjects).toBe(1);
    expect(usage?.uploadCount).toBe(1);
  });

  it("rejects related ciphertext keys outside the authenticated user's prefix", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "prefix");
    send.mockClear();

    const response = await POST(
      request({
        ...(await encryptedUpload(userId, String(bucket._id))),
        thumbnail: "users/another-user/thumbnail",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid related object key",
    });
    expect(send).not.toHaveBeenCalled();
    expect(await StorageObject.countDocuments({ bucketId: bucket._id })).toBe(0);
  });

  it("atomically permits only one active object per content fingerprint", async () => {
    const userId = makeUserId();
    const bucket = await createBucket(userId, "atomic");
    await StorageObject.init();

    const base = {
      bucketId: bucket._id,
      spaceId: `space_personal_${userId}`,
      createdByAccountId: userId,
      size: 100,
      contentType: "application/octet-stream",
      b2FileId: "b2-file",
      isEncrypted: true,
      syncContentFp: "same-content",
    };
    const results = await Promise.allSettled([
      StorageObject.create({ ...base, key: `users/${userId}/first` }),
      StorageObject.create({ ...base, key: `users/${userId}/second` }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await StorageObject.countDocuments({
        bucketId: bucket._id,
        syncContentFp: "same-content",
        deletedAt: { $exists: false },
      }),
    ).toBe(1);
  });

  it("allows re-upload when the matching fingerprint exists only in Bin", async () => {
    const userId = makeUserId();
    const bucket = await createBucket(userId, "deleted");
    await StorageObject.init();
    const base = {
      bucketId: bucket._id,
      spaceId: `space_personal_${userId}`,
      createdByAccountId: userId,
      size: 100,
      contentType: "application/octet-stream",
      b2FileId: "b2-file",
      isEncrypted: true,
      syncContentFp: "deleted-content",
    };

    await StorageObject.create({
      ...base,
      key: `users/${userId}/deleted`,
      deletedAt: new Date(),
    });
    await expect(
      StorageObject.create({
        ...base,
        key: `users/${userId}/active`,
      }),
    ).resolves.toBeTruthy();
  });
});
