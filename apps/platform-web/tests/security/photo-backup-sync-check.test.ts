import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/objects/sync-check/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { makeUserId } from "../helpers/factories";
import {
  ensureOrganizationSpace,
  ensurePersonalSpace,
} from "@xenode/spaces/repository";

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
  void userId;
  void suffix;
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
    { upsert: true, new: true },
  );
  return bucket!;
}

async function createObject(args: {
  bucketId: string;
  userId: string;
  key: string;
  spaceId?: string;
  contentFp?: string;
  metaFp?: string;
  deletedAt?: Date;
}) {
  return StorageObject.create({
    bucketId: args.bucketId,
    spaceId: args.spaceId ?? `space_personal_${args.userId}`,
    createdByAccountId: args.userId,
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

  it("does not surface another user's fingerprints under caller's space", async () => {
    // The physical bucket is shared (single system bucket); isolation is now
    // enforced per-object by spaceId. A caller probing a fingerprint that only
    // exists in ANOTHER user's space must get an empty result, never a match.
    const ownerId = makeUserId();
    const callerId = makeUserId();
    mockSession(callerId);
    const bucket = await createBucket(ownerId, "foreign");
    await ensurePersonalSpace(callerId);
    await createObject({
      bucketId: String(bucket._id),
      userId: ownerId,
      key: `users/${ownerId}/photo`,
      metaFp: "opaque-fingerprint",
    });

    const response = await POST(
      request({
        bucketId: String(bucket._id),
        kind: "meta",
        fingerprints: ["opaque-fingerprint"],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matches: [] });
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

  it("scopes org-scope fingerprint probes to the org space", async () => {
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
    await ensureOrganizationSpace({
      accountId: callerId,
      organizationId: "org_1",
    });

    // An object in the org space and one in the caller's personal space that
    // share a fingerprint. Probing under org scope must find only the org one.
    const orgObject = await createObject({
      bucketId: String(bucket._id),
      userId: callerId,
      spaceId: "space_org_org_1",
      key: "workspaces/org_1/objects/photo",
      contentFp: "shared-fp",
    });
    await createObject({
      bucketId: String(bucket._id),
      userId: callerId,
      key: `users/${callerId}/photo`,
      contentFp: "shared-fp",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/objects/sync-check", {
        method: "POST",
        body: JSON.stringify({
          bucketId: String(bucket._id),
          kind: "content",
          fingerprints: ["shared-fp"],
        }),
        headers: {
          "content-type": "application/json",
          "x-xenode-space-id": "space_org_org_1",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: [{ fp: "shared-fp", id: String(orgObject._id) }],
    });
  });
});
