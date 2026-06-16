import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/objects/sync-check/route";
import { requireAuth } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { makeUserId } from "../helpers/factories";

const mockedRequireAuth = vi.mocked(requireAuth);

async function createBucket(userId: string, suffix: string) {
  return Bucket.create({
    userId,
    name: `sync-${suffix}`,
    b2BucketId: `b2-${suffix}`,
  });
}

async function createObject(args: {
  bucketId: string;
  userId: string;
  key: string;
  contentFp?: string;
  metaFp?: string;
  deletedAt?: Date;
}) {
  return StorageObject.create({
    bucketId: args.bucketId,
    userId: args.userId,
    key: args.key,
    size: 100,
    contentType: "application/octet-stream",
    b2FileId: `b2-file-${args.key}`,
    isEncrypted: true,
    syncContentFp: args.contentFp,
    syncMetaFp: args.metaFp,
    deletedAt: args.deletedAt,
  });
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/objects/sync-check", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("photo backup sync-check contract", () => {
  it("returns active fingerprint matches and ignores deleted objects", async () => {
    const userId = makeUserId();
    mockedRequireAuth.mockResolvedValue({ user: { id: userId } } as never);
    const bucket = await createBucket(userId, "active");
    const active = await createObject({
      bucketId: String(bucket._id),
      userId,
      key: `users/${userId}/active`,
      contentFp: "content-active",
    });
    await createObject({
      bucketId: String(bucket._id),
      userId,
      key: `users/${userId}/deleted`,
      contentFp: "content-deleted",
      deletedAt: new Date(),
    });

    const response = await POST(
      request({
        bucketId: String(bucket._id),
        kind: "content",
        fingerprints: ["content-active", "content-deleted"],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: [{ fp: "content-active", id: String(active._id) }],
    });
  });

  it("does not allow a user to probe another user's bucket", async () => {
    const ownerId = makeUserId();
    const callerId = makeUserId();
    mockedRequireAuth.mockResolvedValue({ user: { id: callerId } } as never);
    const bucket = await createBucket(ownerId, "foreign");

    const response = await POST(
      request({
        bucketId: String(bucket._id),
        kind: "meta",
        fingerprints: ["opaque-fingerprint"],
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Bucket not found",
    });
  });

  it("scopes shared system buckets to the caller's prefix", async () => {
    const callerId = makeUserId();
    const otherId = makeUserId();
    mockedRequireAuth.mockResolvedValue({ user: { id: callerId } } as never);
    const bucket = await createBucket("system", "system");
    const callerObject = await createObject({
      bucketId: String(bucket._id),
      userId: callerId,
      key: `users/${callerId}/photo`,
      metaFp: "same-meta",
    });
    await createObject({
      bucketId: String(bucket._id),
      userId: otherId,
      key: `users/${otherId}/photo`,
      metaFp: "same-meta",
    });

    const response = await POST(
      request({
        bucketId: String(bucket._id),
        kind: "meta",
        fingerprints: ["same-meta"],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: [{ fp: "same-meta", id: String(callerObject._id) }],
    });
  });
});
