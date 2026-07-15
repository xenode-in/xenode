import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/share/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import OrganizationPolicy from "@/models/OrganizationPolicy";
import ShareLink from "@/models/ShareLink";
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
  return new NextRequest("http://localhost/api/share", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

async function createObject(userId: string) {
  const safeUserId = userId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const bucket = await Bucket.create({
    userId,
    name: `share-${safeUserId}`,
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

async function createOrganizationObject(orgId = "org_1") {
  const bucket = await Bucket.create({
    userId: "system",
    ownerScope: "organization",
    orgId,
    name: "xenode-organization-dev",
    b2BucketId: "xenode-organization-dev",
  });

  return StorageObject.create({
    bucketId: bucket._id,
    userId: "system",
    ownerScope: "organization",
    orgId,
    key: `workspaces/${orgId}/objects/file`,
    size: 100,
    contentType: "application/octet-stream",
    mediaCategory: "other",
    b2FileId: "b2-org-file",
    isEncrypted: true,
    encryptedDEK: "wrapped-org-dek",
    spaceKeyWrapIv: "space-key-iv",
    spaceKeyVersion: 1,
  });
}

async function addOrgMember(userId = "user_1", role = "admin", orgId = "org_1") {
  await Bucket.db.collection("member").insertOne({
    userId,
    organizationId: orgId,
    role,
    createdAt: new Date(),
  });
}

function shareBody(objectId: string) {
  return {
    token: `token-${objectId}`,
    objectId,
    accessType: "download",
    shareEncryptedDEK: "share-encrypted-dek",
    shareKeyIv: "share-key-iv",
  };
}

describe("organization share-link route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("creates share links for personally owned objects", async () => {
    mockSession("user_1");
    const object = await createObject("user_1");

    const response = await POST(request(shareBody(String(object._id))));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBe(`token-${object._id}`);
    expect(await ShareLink.countDocuments({ createdBy: "user_1" })).toBe(1);
  });

  it("does not create share links for another user's personal object", async () => {
    mockSession("user_1");
    const object = await createObject("user_2");

    const response = await POST(request(shareBody(String(object._id))));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "File not found",
      code: "object_not_found",
    });
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it("creates share links for organization objects in organization scope", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const object = await createOrganizationObject();
    await addOrgMember();

    const response = await POST(
      request(shareBody(String(object._id)), {
        "x-xenode-space-id": "space_org_org_1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBe(`token-${object._id}`);
    expect(await ShareLink.countDocuments({ createdBy: "user_1" })).toBe(1);
  });

  it("enforces disabled public links for organization share links", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const object = await createOrganizationObject();
    await addOrgMember();
    await OrganizationPolicy.create({
      orgId: "org_1",
      allowPublicLinks: false,
    });

    const response = await POST(
      request(shareBody(String(object._id)), {
        "x-xenode-space-id": "space_org_org_1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("organization_public_links_disabled");
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it("enforces password and expiry requirements for organization share links", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const object = await createOrganizationObject();
    await addOrgMember();
    await OrganizationPolicy.create({
      orgId: "org_1",
      requirePassword: true,
      requireExpiry: true,
    });

    const missingPassword = await POST(
      request({ ...shareBody(String(object._id)), expiresIn: 24 }, {
        "x-xenode-space-id": "space_org_org_1",
      }),
    );
    expect(missingPassword.status).toBe(400);
    await expect(missingPassword.json()).resolves.toMatchObject({
      code: "organization_share_password_required",
    });

    const missingExpiry = await POST(
      request({ ...shareBody(String(object._id)), password: "secret" }, {
        "x-xenode-space-id": "space_org_org_1",
      }),
    );
    expect(missingExpiry.status).toBe(400);
    await expect(missingExpiry.json()).resolves.toMatchObject({
      code: "organization_share_expiry_required",
    });

    const allowed = await POST(
      request(
        { ...shareBody(String(object._id)), password: "secret", expiresIn: 24 },
        { "x-xenode-space-id": "space_org_org_1" },
      ),
    );
    expect(allowed.status).toBe(200);
    expect(await ShareLink.countDocuments()).toBe(1);
  });
});
