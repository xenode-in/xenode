import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as bucketsGET } from "@/app/api/orgs/[orgId]/buckets/route";
import { GET as objectsGET } from "@/app/api/orgs/[orgId]/objects/route";
import { POST as completeUploadPOST } from "@/app/api/objects/complete-upload/route";
import { POST as presignPOST } from "@/app/api/objects/presign-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import OrgUsage from "@/models/OrgUsage";
import { ensureOrganizationSpace } from "@xenode/spaces/repository";

vi.mock("@/lib/b2/buckets", () => ({
  createB2Bucket: vi.fn(async (name: string) => `b2-${name}`),
}));

vi.mock("@/lib/b2/client", () => ({
  getS3Client: vi.fn(() => ({
    send: vi.fn(async () => ({ VersionId: "b2-version-1", ContentLength: 10 })),
  })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://upload.example.test/presigned"),
}));

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "user_1") {
  mockedGetServerSession.mockResolvedValue({
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: `User ${userId}`,
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

async function createOrg(id = "org_1") {
  await Bucket.db.collection("organization").insertOne({
    id,
    name: id === "org_1" ? "Acme" : "Other",
    slug: id,
    logo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await OrgUsage.findOneAndUpdate(
    { orgId: id }, { $setOnInsert: { orgId: id, accountId: `org:${id}` } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

async function addMember(userId: string, role = "member", orgId = "org_1") {
  await Bucket.db.collection("member").insertOne({
    id: `mem_${orgId}_${userId}`,
    userId,
    organizationId: orgId,
    role,
    createdAt: new Date(),
  });
  await ensureOrganizationSpace({ accountId: userId, organizationId: orgId });
}

async function createOrgBucket(orgId = "org_1") {
  await createOrg(orgId).catch(() => {});
  return Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    {
      $setOnInsert: {
        systemKey: "drive",
        name: "xenode-drive-storage",
        b2BucketId: "xenode-drive-storage",
      },
    },
    { new: true, upsert: true },
  );
}

function params(orgId = "org_1") {
  return { params: Promise.resolve({ orgId }) };
}

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            ...(path.startsWith("/api/objects/") ? { "x-xenode-space-id": "space_org_org_1" } : {}),
          },
        }),
  });
}

describe("organization storage API", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    delete process.env.S3_KEY_ID;
    delete process.env.S3_APPLICATION_KEY;
    mockedGetServerSession.mockReset();
  });

  it("lists the shared organization storage bucket", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");

    const listResponse = await bucketsGET(
      request("/api/orgs/org_1/buckets"),
      params(),
    );
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.buckets).toHaveLength(1);
    expect(listBody.buckets[0]).toMatchObject({
      systemKey: "drive",
      name: "xenode-drive-storage",
      b2BucketId: "xenode-drive-storage",
    });
  });

  it("does not allow guests to use organization storage", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1");
    await createOrg();
    await addMember("guest_1", "guest");

    const response = await bucketsGET(
      request("/api/orgs/org_1/buckets"),
      params(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_role_required",
    });
  });

  it("requires org uploads to be encrypted and wrapped by the space key", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    const bucket = await createOrgBucket();

    const response = await completeUploadPOST(
      request("/api/objects/complete-upload", "POST", {
        bucketId: bucket!._id.toString(),
        objectKey: "workspaces/org_1/objects/file.txt",
        sessionId: "000000000000000000000001",
        size: 10,
        contentType: "text/plain",
        isEncrypted: true,
        wrappedBy: "user",
        encryptedDEK: "wrapped",
        spaceKeyVersion: 1,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "Organization and team uploads must be encrypted and wrapped by the workspace space key",
      code: "workspace_space_wrapped_encryption_required",
    });
  });

  it("presigns organization uploads under the org key prefix", async () => {
    process.env.ORGS_ENABLED = "true";
    process.env.S3_KEY_ID = "test-key";
    process.env.S3_APPLICATION_KEY = "test-secret";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    await ensureOrganizationSpace({ accountId: "member_1", organizationId: "org_1" });
    const bucket = await createOrgBucket();

    const response = await presignPOST(
      new NextRequest("http://localhost/api/objects/presign-upload", {
        method: "POST",
        body: JSON.stringify({
          bucketId: bucket!._id.toString(),
          fileName: "../leaky-name.txt",
          fileType: "application/octet-stream",
          fileSize: 10,
          prefix: "workspaces/org_1/objects/",
        }),
        headers: {
          "content-type": "application/json",
          "x-xenode-space-id": "space_org_org_1",
        },
      }),
    );
    const body = await response.json();

    delete process.env.S3_KEY_ID;
    delete process.env.S3_APPLICATION_KEY;

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe("https://upload.example.test/presigned");
    expect(body.objectKey).toMatch(/^workspaces\/org_1\/objects\/[0-9a-f]{32}$/u);
    expect(body.sessionId).toMatch(/^[0-9a-f]{24}$/u);
    expect(body.objectKey).not.toContain("users/member_1");
    expect(body.spaceType).toBe("organization");
    expect(body.spaceId).toBe("space_org_org_1");
  });

  it("finalizes a space-wrapped org object and lists only that org's objects", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg("org_1");
    await createOrg("org_2");
    await addMember("member_1", "member", "org_1");
    const bucket = await createOrgBucket("org_1");
    const otherBucket = await createOrgBucket("org_2");

    await StorageObject.create({
      bucketId: otherBucket!._id,
      spaceId: "space_org_org_2",
      createdByAccountId: "other",
      key: "workspaces/org_2/objects/other.txt",
      size: 20,
      contentType: "text/plain",
      mediaCategory: "document",
      b2FileId: "other",
      isEncrypted: true,
      encryptedDEK: "other",
      wrappedBy: "space",
      spaceKeyVersion: 1,
    });

    const presign = await presignPOST(request("/api/objects/presign-upload", "POST", {
      bucketId: bucket!._id.toString(), fileSize: 10, fileType: "application/octet-stream",
    }));
    expect(presign.status).toBe(200);
    const reserved = await presign.json();
    const completeResponse = await completeUploadPOST(
      request("/api/objects/complete-upload", "POST", {
        bucketId: bucket!._id.toString(),
        objectKey: reserved.objectKey,
        sessionId: reserved.sessionId,
        size: 10,
        contentType: "text/plain",
        isEncrypted: true,
        wrappedBy: "space",
        encryptedDEK: "space-wrapped-dek",
        spaceKeyWrapIv: "wrap-iv",
        spaceKeyVersion: 2,
        encryptedName: "encrypted-name",
      }),
    );
    const completeBody = await completeResponse.json();

    expect(completeResponse.status).toBe(201);
    expect(completeBody.object).toMatchObject({
      spaceId: "space_org_org_1",
      createdByAccountId: "member_1",
      key: reserved.objectKey,
      wrappedBy: "space",
      spaceKeyVersion: 2,
      encryptedDEK: "space-wrapped-dek",
    });

    const listResponse = await objectsGET(
      request(`/api/orgs/org_1/objects?bucketId=${bucket!._id.toString()}&fetchAll=true`),
      params("org_1"),
    );
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.objects).toHaveLength(1);
    expect(listBody.objects[0].key).toBe(reserved.objectKey);
  });
});
