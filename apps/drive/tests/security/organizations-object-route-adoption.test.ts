import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as metadataGET } from "@/app/api/objects/metadata/route";
import { DELETE as objectDELETE } from "@/app/api/objects/[id]/route";
import { POST as completeUploadPOST } from "@/app/api/objects/complete-upload/route";
import { POST as folderPOST } from "@/app/api/objects/folder/route";
import { PATCH as reorderPATCH } from "@/app/api/objects/reorder/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import {
  ensurePersonalSpace,
  ensureOrganizationSpace,
  ensureTeamSpace,
} from "@xenode/spaces/repository";

const mockedGetServerSession = vi.mocked(getServerSession);

vi.mock("@/lib/subscriptions/service", () => ({
  enforceStorageAccess: vi.fn(async () => undefined),
}));

vi.mock("@/lib/b2/client", () => ({
  getS3Client: vi.fn(() => ({
    send: vi.fn(async () => ({ VersionId: "b2-version" })),
  })),
}));

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
  void userId;
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
    { upsert: true, new: true },
  );
  return bucket!;
}

async function addOrgMember(userId = "user_1", role = "admin") {
  await Bucket.db.collection("member").insertOne({
    userId,
    organizationId: "org_1",
    role,
    createdAt: new Date(),
  });
}

async function addTeamMember(userId = "user_1", teamId = "team_1") {
  await Bucket.db.collection("team").insertOne({
    id: teamId,
    name: "Engineering",
    organizationId: "org_1",
    createdAt: new Date(),
  });
  await Bucket.db.collection("teamMember").insertOne({
    userId,
    teamId,
    createdAt: new Date(),
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
    await ensurePersonalSpace("user_1");
    const object = await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_personal_user_1",
      createdByAccountId: "user_1",
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

  it("does not expose personal objects in metadata under org scope", async () => {
    // The physical bucket is shared, so it resolves under org scope (200).
    // Isolation is now enforced per-object by spaceId: a personal object must
    // never appear when listing under the organization space.
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    await addOrgMember("user_1");
    await ensurePersonalSpace("user_1");
    await ensureOrganizationSpace({ accountId: "user_1", organizationId: "org_1" });
    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_personal_user_1",
      createdByAccountId: "user_1",
      key: "users/user_1/photo",
      size: 100,
      contentType: "image/jpeg",
      mediaCategory: "image",
      b2FileId: "b2-personal",
      isEncrypted: true,
    });

    const response = await metadataGET(
      new NextRequest(
        `http://localhost/api/objects/metadata?bucketId=${bucket._id}`,
        { headers: { "x-xenode-space-id": "space_org_org_1" } },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.items).toEqual([]);
  });

  it("does not create folders under a personal prefix in org scope", async () => {
    // A personal-prefixed key ("users/...") is outside the org key namespace;
    // the route must reject it rather than plant an org folder in personal space.
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    await addOrgMember("user_1");
    await ensureOrganizationSpace({ accountId: "user_1", organizationId: "org_1" });

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
          "x-xenode-space-id": "space_org_org_1",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Access denied to this folder",
    });
  });

  it("does not reorder personal-space objects under org scope", async () => {
    // Reorder's bulkWrite is scoped by spaceId, so a caller acting under the org
    // space cannot move an object that lives in their personal space.
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    const bucket = await createBucket("user_1");
    await addOrgMember("user_1");
    await ensurePersonalSpace("user_1");
    await ensureOrganizationSpace({ accountId: "user_1", organizationId: "org_1" });
    const personalObject = await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_personal_user_1",
      createdByAccountId: "user_1",
      key: "users/user_1/photo",
      size: 100,
      contentType: "image/jpeg",
      mediaCategory: "image",
      b2FileId: "b2-personal",
      isEncrypted: true,
      position: 0,
    });

    const response = await reorderPATCH(
      new NextRequest("http://localhost/api/objects/reorder", {
        method: "PATCH",
        body: JSON.stringify({
          bucketId: String(bucket._id),
          items: [{ id: String(personalObject._id), position: 99 }],
        }),
        headers: {
          "content-type": "application/json",
          "x-xenode-space-id": "space_org_org_1",
        },
      }),
    );

    expect(response.status).toBe(200);
    // The personal object's position is untouched by the org-scoped reorder.
    const reloaded = await StorageObject.findById(personalObject._id).lean();
    expect(reloaded?.position).toBe(0);
  });

  it("requires space-wrapped encryption on generic org complete-upload", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await addOrgMember("user_1", "member");
    await ensureOrganizationSpace({ accountId: "user_1", organizationId: "org_1" });
    const bucket = await createBucket();

    const response = await completeUploadPOST(
      new NextRequest("http://localhost/api/objects/complete-upload", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-xenode-space-id": "space_org_org_1",
        },
        body: JSON.stringify({
          bucketId: String(bucket._id),
          objectKey: "workspaces/org_1/objects/file.txt",
          size: 10,
          contentType: "application/octet-stream",
          originalContentType: "text/plain",
          isEncrypted: true,
          wrappedBy: "user",
          encryptedDEK: "rsa-wrapped",
          iv: "iv",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "Organization and team uploads must be encrypted and wrapped by the workspace space key",
      code: "workspace_space_wrapped_encryption_required",
    });
  });

  it("forbids ordinary team members from deleting team drive objects", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await addOrgMember("user_1", "member");
    await addTeamMember("user_1");
    const bucket = await createBucket();
    await ensureTeamSpace({ accountId: "user_1", organizationId: "org_1", teamId: "team_1" });
    const object = await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_team_org_1_team_1",
      createdByAccountId: "org:org_1",
      key: "workspaces/org_1/teams/team_1/objects/file.txt",
      size: 10,
      contentType: "text/plain",
      mediaCategory: "document",
      b2FileId: "b2-file",
      isEncrypted: true,
      wrappedBy: "space",
      encryptedDEK: "wrapped",
      spaceKeyVersion: 1,
      spaceKeyWrapIv: "wrap-iv",
    });

    const response = await objectDELETE(
      new NextRequest(`http://localhost/api/objects/${object._id}`, {
        method: "DELETE",
        headers: {
          "x-xenode-space-id": "space_team_org_1_team_1",
        },
      }),
      { params: Promise.resolve({ id: object._id.toString() }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "workspace_delete_role_required",
    });
  });

  it("allows org admins to delete team drive objects", async () => {
    // The "manager" role was removed (roles are owner/admin/member/guest); an
    // org admin who is also a team member may delete team drive objects.
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1");
    await addOrgMember("admin_1", "admin");
    await addTeamMember("admin_1");
    const bucket = await createBucket();
    await ensureTeamSpace({ accountId: "admin_1", organizationId: "org_1", teamId: "team_1" });
    const object = await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_team_org_1_team_1",
      createdByAccountId: "org:org_1",
      key: "workspaces/org_1/teams/team_1/objects/file.txt",
      size: 10,
      contentType: "text/plain",
      mediaCategory: "document",
      b2FileId: "b2-file",
      isEncrypted: true,
      wrappedBy: "space",
      encryptedDEK: "wrapped",
      spaceKeyVersion: 1,
      spaceKeyWrapIv: "wrap-iv",
    });

    const response = await objectDELETE(
      new NextRequest(`http://localhost/api/objects/${object._id}`, {
        method: "DELETE",
        headers: {
          "x-xenode-space-id": "space_team_org_1_team_1",
        },
      }),
      { params: Promise.resolve({ id: object._id.toString() }) },
    );

    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({ success: true });
    await expect(
      StorageObject.exists({ _id: object._id, deletedAt: { $exists: true } }),
    ).resolves.toBeTruthy();
  });
});
