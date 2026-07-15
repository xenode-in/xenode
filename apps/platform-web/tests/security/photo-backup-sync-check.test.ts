import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/objects/sync-check/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { makeUserId } from "../helpers/factories";

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
      activeOrganizationId: "org_1",
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

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
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("returns active fingerprint matches and ignores deleted objects", async () => {
    const userId = makeUserId();
    mockSession(userId);
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
    mockSession(callerId);
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
    mockSession(callerId);
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

  it("fails closed for explicit org-scope fingerprint probes until org storage is enabled", async () => {
    process.env.ORGS_ENABLED = "true";
    const callerId = makeUserId();
    mockSession(callerId);
    const bucket = await createBucket(callerId, "org-probe");
    await Bucket.db.collection("member").insertOne({
      userId: callerId,
      organizationId: "org_1",
      role: "admin",
      createdAt: new Date(),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/objects/sync-check", {
        method: "POST",
        body: JSON.stringify({
          bucketId: String(bucket._id),
          kind: "content",
          fingerprints: ["opaque-fingerprint"],
        }),
        headers: {
          "content-type": "application/json",
          "x-xenode-space-id": "space_org_org_1",
        },
      }),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Organization storage is not enabled yet",
      code: "organization_storage_not_ready",
    });
  });
});
