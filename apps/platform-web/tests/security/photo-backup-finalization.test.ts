import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/b2/client", () => ({
  getS3Client: () => ({ send }),
}));

import { POST } from "@/app/api/objects/complete-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
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
  return Bucket.create({
    userId,
    name: `finalize-${suffix}`,
    b2BucketId: `b2-finalize-${suffix}`,
  });
}

function encryptedUpload(userId: string, bucketId: string) {
  return {
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
}

describe("photo backup complete-upload finalization", () => {
  it("rolls back metadata and uploaded blobs when quota rejects finalization", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "quota");
    await createUsage({
      userId,
      totalStorageBytes: 500,
      storageLimitBytes: 500,
    });
    send.mockResolvedValue({});

    const body = encryptedUpload(userId, String(bucket._id));
    const response = await POST(request(body));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Storage quota exceeded",
    });
    expect(await StorageObject.countDocuments({ bucketId: bucket._id })).toBe(0);

    const deletedKeys = send.mock.calls
      .map(([command]) => command?.input?.Key)
      .filter(Boolean);
    expect(deletedKeys).toEqual(
      expect.arrayContaining([
        body.objectKey,
        body.optimizedKey,
        body.thumbnail,
      ]),
    );
  });

  it("does not mutate an existing object when its size increase exceeds quota", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "existing-quota");
    const body = encryptedUpload(userId, String(bucket._id));
    await StorageObject.create({
      bucketId: bucket._id,
      userId,
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

    expect(response.status).toBe(402);
    const existing = await StorageObject.findOne({ key: body.objectKey });
    const usage = await Usage.findOne({ userId });
    expect(existing?.size).toBe(500);
    expect(usage?.totalStorageBytes).toBe(500);
    expect(usage?.totalObjects).toBe(1);
    expect(usage?.uploadCount).toBe(1);
  });

  it("adjusts only bytes when an existing object changes size", async () => {
    const userId = makeUserId();
    mockSession(userId);
    const bucket = await createBucket(userId, "existing-resize");
    const body = encryptedUpload(userId, String(bucket._id));
    await StorageObject.create({
      bucketId: bucket._id,
      userId,
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

    expect(response.status).toBe(200);
    const usage = await Usage.findOne({ userId });
    expect(usage?.totalStorageBytes).toBe(1_000);
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
        ...encryptedUpload(userId, String(bucket._id)),
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
      userId,
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
      userId,
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
