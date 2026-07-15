import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/direct-shares/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import DirectShare from "@/models/DirectShare";
import StorageObject from "@/models/StorageObject";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "user_1") {
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

function request(body: unknown, headers?: HeadersInit) {
  return new NextRequest("http://localhost/api/direct-shares", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

async function createObject(userId: string) {
  const safeUserId = userId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const bucket = await Bucket.create({
    userId,
    name: `bucket-${safeUserId}`,
    b2BucketId: `b2-${userId}`,
  });

  return StorageObject.create({
    bucketId: bucket._id,
    userId,
    key: `users/${userId}/file`,
    size: 100,
    contentType: "application/octet-stream",
    mediaCategory: "other",
    b2FileId: "b2-file",
    isEncrypted: true,
    encryptedDEK: "wrapped-user-dek",
  });
}

function shareBody(objectId: string) {
  return {
    objectId,
    shareEncryptedDEK: "share-encrypted-dek",
    shareKeyIv: "share-key-iv",
    recipients: [
      {
        recipientUserId: "recipient_1",
        recipientEmail: "recipient@example.com",
        wrappedShareKey: "wrapped-share-key",
        accessType: "download",
      },
    ],
  };
}

describe("organization direct-share route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("creates direct shares for personally owned objects", async () => {
    mockSession("user_1");
    const object = await createObject("user_1");

    const response = await POST(request(shareBody(String(object._id))));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recipientCount).toBe(1);
    expect(await DirectShare.countDocuments({ createdBy: "user_1" })).toBe(1);
  });

  it("does not share another user's personal object", async () => {
    mockSession("user_1");
    const object = await createObject("user_2");

    const response = await POST(request(shareBody(String(object._id))));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "File not found" });
    expect(await DirectShare.countDocuments()).toBe(0);
  });

  it("fails closed for explicit org direct-share creation until org storage is enabled", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const object = await createObject("user_1");
    await Bucket.db.collection("member").insertOne({
      userId: "user_1",
      organizationId: "org_1",
      role: "admin",
      createdAt: new Date(),
    });

    const response = await POST(
      request(shareBody(String(object._id)), {
        "x-xenode-space-id": "space_org_org_1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toEqual({
      error: "Organization storage is not enabled yet",
      code: "organization_storage_not_ready",
    });
    expect(await DirectShare.countDocuments()).toBe(0);
  });
});
