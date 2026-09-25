import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "@xenode/database";

// Mock the B2 object layer so no real network calls happen. `listObjects`
// returns whatever blobs "exist" under a prefix; `deleteObjects` records what
// the cron tried to delete.
const { deleteObjects, listObjects } = vi.hoisted(() => ({
  deleteObjects: vi.fn(async (_bucket: string, _keys: string[]) => {}),
  listObjects: vi.fn(async (_bucket: string, prefix?: string) => ({
    objects: prefix ? [{ key: prefix, size: 10 }] : [],
    isTruncated: false as const,
    nextContinuationToken: undefined,
  })),
}));

vi.mock("@/lib/b2/objects", () => ({ deleteObjects, listObjects }));

import { GET } from "@/app/api/cron/cleanup-orphans/route";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import UploadSession from "@/models/UploadSession";
import { makeUserId } from "../helpers/factories";

const CRON_SECRET = "test-cron-secret";

function cronRequest() {
  return new NextRequest("http://localhost/api/cron/cleanup-orphans", {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

async function seedBucket(userId: string, suffix: string) {
  void userId;
  void suffix;
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
    { upsert: true, new: true },
  );
  return bucket!;
}

/** A session already past its 24h grace window. */
function expired() {
  return new Date(Date.now() - 60 * 60 * 1000);
}

describe("cleanup-orphans: thumbnail protection", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    deleteObjects.mockReset();
    listObjects.mockClear();
  });

  it("never deletes a blob still referenced as a live file's thumbnail", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "thumb");
    const mainKey = `users/${userId}/main`;
    const thumbKey = `${mainKey}-thumb`;

    // Live, fully-uploaded file whose thumbnail lives at thumbKey.
    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: `space_personal_${userId}`,
      createdByAccountId: userId,
      key: mainKey,
      thumbnail: thumbKey,
      size: 1000,
      b2FileId: "b2-main",
    });

    // A legacy orphan "thumb session" (created before thumbnails attached to
    // their parent) that never flipped to completed and is now expired.
    await UploadSession.create({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      fileId: thumbKey,
      keys: [thumbKey],
      status: "pending",
      expiresAt: expired(),
    });

    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // The live thumbnail must NOT be deleted...
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(body.skippedLive).toBe(1);
    // ...and the stale ledger row is retired so it stops being re-scanned.
    expect(await UploadSession.countDocuments({ fileId: thumbKey })).toBe(0);
  });

  it("never deletes a blob still referenced as a live file's optimized preview", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "opt");
    const mainKey = `users/${userId}/main`;
    const optKey = `users/${userId}/optimized`;

    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: `space_personal_${userId}`,
      createdByAccountId: userId,
      key: mainKey,
      optimizedKey: optKey,
      size: 1000,
      b2FileId: "b2-main",
    });

    await UploadSession.create({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      fileId: optKey,
      keys: [optKey],
      status: "pending",
      expiresAt: expired(),
    });

    const res = await GET(cronRequest());
    const body = await res.json();

    expect(deleteObjects).not.toHaveBeenCalled();
    expect(body.skippedLive).toBe(1);
  });

  it("still reclaims a genuinely orphaned upload", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "orphan");
    const orphanKey = `users/${userId}/abandoned`;

    // No StorageObject references this key — a true orphan.
    await UploadSession.create({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      fileId: orphanKey,
      keys: [orphanKey, `${orphanKey}-thumb`],
      status: "pending",
      expiresAt: expired(),
    });

    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    const deletedKeys = deleteObjects.mock.calls[0][1] as string[];
    expect(deletedKeys).toContain(orphanKey);
    expect(body.skippedLive).toBe(0);
    expect(await UploadSession.countDocuments({ fileId: orphanKey })).toBe(0);
  });

  it("leaves an in-flight upload alone until its grace window expires", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "inflight");
    const key = `users/${userId}/uploading`;

    await UploadSession.create({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      fileId: key,
      keys: [key],
      status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // not yet expired
    });

    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(await UploadSession.countDocuments({ fileId: key })).toBe(1);
  });

  it.each(["trash", "photos", "chunk", "version", "version-chunk"])(
    "protects a retained %s reference to a ledgered secondary key",
    async (kind) => {
      const userId = makeUserId();
      const bucket = await seedBucket(userId, kind);
      const fileId = `users/${userId}/abandoned`;
      const key = `${fileId}-secondary`;
      const fields = kind === "chunk" ? { chunks: [{ key }] }
        : kind === "version" ? { versions: [{ key }] }
          : kind === "version-chunk" ? { versions: [{ key: "old-logical", chunks: [{ key }] }] }
            : { thumbnail: key };
      await getDatabase().collection("storageobjects").insertOne({
        bucketId: bucket._id, key: `users/${userId}/retained`,
        productId: kind === "photos" ? "photos" : "drive",
        ...(kind === "trash" ? { deletedAt: new Date() } : {}), ...fields,
      });
      await UploadSession.create({ userId, spaceId: `space_personal_${userId}`, bucketId: bucket._id, fileId, keys: [fileId, key], status: "pending", expiresAt: expired() });
      const response = await GET(cronRequest());
      expect(response.status).toBe(200);
      expect(deleteObjects).not.toHaveBeenCalled();
      expect((await response.json()).skippedLive).toBe(1);
    },
  );

  it("deletes only exact ledger keys, never every object sharing their prefix", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "prefix");
    const fileId = `users/${userId}/prefix`;
    await UploadSession.create({ userId, spaceId: `space_personal_${userId}`, bucketId: bucket._id, fileId, keys: [fileId], status: "pending", expiresAt: expired() });
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    expect(listObjects).not.toHaveBeenCalled();
    expect(deleteObjects).toHaveBeenCalledWith(bucket.b2BucketId, [fileId]);
  });

  it("retains the ledger if storage deletion fails", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "failure");
    const fileId = `users/${userId}/failed`;
    await UploadSession.create({ userId, spaceId: `space_personal_${userId}`, bucketId: bucket._id, fileId, keys: [fileId], status: "pending", expiresAt: expired() });
    deleteObjects.mockRejectedValueOnce(new Error("storage unavailable"));
    expect((await GET(cronRequest())).status).toBe(500);
    expect(await UploadSession.countDocuments({ fileId })).toBe(1);
  });

  it("retains the ledger when physical bucket metadata is unavailable", async () => {
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "missing");
    const fileId = `users/${userId}/missing-bucket`;
    await UploadSession.create({ userId, spaceId: `space_personal_${userId}`, bucketId: bucket._id, fileId, keys: [fileId], status: "pending", expiresAt: expired() });
    await Bucket.deleteOne({ _id: bucket._id });
    expect((await GET(cronRequest())).status).toBe(500);
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(await UploadSession.countDocuments({ fileId })).toBe(1);
  });
});

describe("attachToUploadSession: session ownership", () => {
  it("attaches a secondary blob only to an existing session owned by the user", async () => {
    const { attachToUploadSession } = await import("@/lib/uploads/session");
    const userId = makeUserId();
    const otherUserId = makeUserId();
    const bucket = await seedBucket(userId, "attach");
    const mainKey = `users/${userId}/main`;

    // Parent session created by the main upload.
    const parent = await UploadSession.create({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      fileId: mainKey,
      keys: [mainKey, `${mainKey}-thumb`],
      status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Owner can attach — key is unioned into the parent, no new row created.
    const attached = await attachToUploadSession({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      parentFileId: mainKey,
      parentSessionId: parent._id.toString(),
      key: `${mainKey}-thumb`,
    });
    expect(attached).toBe(parent._id.toString());
    expect(await UploadSession.countDocuments({ bucketId: bucket._id })).toBe(1);

    // A different user cannot attach to the reservation.
    const foreign = await attachToUploadSession({
      userId: otherUserId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      parentFileId: mainKey,
      parentSessionId: parent._id.toString(),
      key: "malicious-key",
    });
    expect(foreign).toBeNull();
    const reloaded = await UploadSession.findById(parent._id).lean();
    expect(reloaded?.keys).not.toContain("malicious-key");
  });

  it("does not attach new keys to a completed parent session", async () => {
    const { attachToUploadSession } = await import("@/lib/uploads/session");
    const userId = makeUserId();
    const bucket = await seedBucket(userId, "completed");
    const mainKey = `users/${userId}/done`;

    const parent = await UploadSession.create({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      fileId: mainKey,
      keys: [mainKey],
      status: "completed",
      expiresAt: new Date(Date.now() - 1000),
    });

    const attached = await attachToUploadSession({
      userId,
      spaceId: `space_personal_${userId}`,
      bucketId: bucket._id,
      parentFileId: mainKey,
      parentSessionId: parent._id.toString(),
      key: `${mainKey}-thumb`,
    });

    expect(attached).toBeNull();
    const reloaded = await UploadSession.findById(parent._id).lean();
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.keys).not.toContain(`${mainKey}-thumb`);
  });
});
