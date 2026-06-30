import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as metadataGET } from "@/app/api/objects/metadata/route";
import { POST as folderPOST } from "@/app/api/objects/folder/route";
import { PATCH as reorderPATCH } from "@/app/api/objects/reorder/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
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

async function createBucket(userId = "user_1") {
  return Bucket.create({
    userId,
    name: `objects-${userId.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`,
    b2BucketId: `b2-${userId}`,
  });
}

async function addOrgMember(userId = "user_1") {
  await Bucket.db.collection("member").insertOne({
    userId,
    organizationId: "org_1",
    role: "admin",
    createdAt: new Date(),
  });
}

function expectOrgStorageClosed(body: unknown) {
  expect(body).toEqual({
    error: "Organization storage is not enabled yet",
    code: "organization_storage_not_ready",
  });
}

describe("organization object route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("keeps metadata listing scoped to the personal bucket owner", async () => {
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    const object = await StorageObject.create({
      bucketId: bucket._id,
      userId: "user_1",
      key: "users/user_1/photo",
      size: 100,
      contentType: "image/jpeg",
      mediaCategory: "image",
      b2FileId: "b2-file",
      isEncrypted: true,
    });

    const response = await metadataGET(
      new NextRequest(
        `http://localhost/api/objects/metadata?bucketId=${bucket._id}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.items[0]._id).toBe(String(object._id));
  });

  it("fails closed for explicit org metadata requests", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    await addOrgMember("user_1");

    const response = await metadataGET(
      new NextRequest(
        `http://localhost/api/objects/metadata?bucketId=${bucket._id}`,
        { headers: { "x-xenode-drive-scope": "organization" } },
      ),
    );

    expect(response.status).toBe(501);
    expectOrgStorageClosed(await response.json());
  });

  it("fails closed for explicit org folder creation requests", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    await addOrgMember("user_1");

    const response = await folderPOST(
      new NextRequest("http://localhost/api/objects/folder", {
        method: "POST",
        body: JSON.stringify({
          bucketId: String(bucket._id),
          name: "Design",
          prefix: "users/user_1/",
        }),
        headers: {
          "content-type": "application/json",
          "x-xenode-drive-scope": "organization",
        },
      }),
    );

    expect(response.status).toBe(501);
    expectOrgStorageClosed(await response.json());
  });

  it("fails closed for explicit org reorder requests", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    await addOrgMember("user_1");

    const response = await reorderPATCH(
      new NextRequest("http://localhost/api/objects/reorder", {
        method: "PATCH",
        body: JSON.stringify({
          bucketId: String(bucket._id),
          items: [{ id: "object_1", position: 1 }],
        }),
        headers: {
          "content-type": "application/json",
          "x-xenode-drive-scope": "organization",
        },
      }),
    );

    expect(response.status).toBe(501);
    expectOrgStorageClosed(await response.json());
  });
});
