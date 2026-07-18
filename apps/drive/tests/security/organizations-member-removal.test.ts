import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE as memberDELETE } from "@/app/api/orgs/[orgId]/members/[memberUserId]/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import { createTestProductKey, SpaceProductKey } from "@/tests/helpers/spaceProductKeys";
import { organizationSpaceId } from "@xenode/spaces/ids";
import { ensureOrganizationSpace } from "@xenode/spaces/repository";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "owner_1") {
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
      activeOrganizationId: "org_1",
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function createOrg() {
  await Bucket.db.collection("organization").insertOne({
    id: "org_1",
    name: "Acme",
    slug: "acme",
    logo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await ensureOrganizationSpace({
    accountId: "owner_1",
    organizationId: "org_1",
  });
}

async function addMember(userId: string, role = "member") {
  await Bucket.db.collection("member").insertOne({
    id: `mem_${userId}`,
    userId,
    organizationId: "org_1",
    role,
    createdAt: new Date(),
  });
}

async function addSession(userId: string) {
  await Bucket.db.collection("session").insertOne({
    id: `session-${userId}`,
    userId,
    activeOrganizationId: "org_1",
    activeTeamId: "team_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function addProductKey(userId: string, keyVersion = 1) {
  await createTestProductKey({
    spaceId: organizationSpaceId("org_1"),
    memberAccountId: userId,
    wrappedKey: `wrapped-${userId}-v${keyVersion}`,
    keyVersion,
    createdByAccountId: "owner_1",
    rotationReason: "initial",
  });
}

function params(memberUserId = "user_1") {
  return { params: Promise.resolve({ orgId: "org_1", memberUserId }) };
}

function deleteRequest(body: unknown = {}) {
  return new NextRequest("http://localhost/api/orgs/org_1/members/user_1", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("organization member removal", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("requires admins to remove members", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    await addMember("user_1", "member");

    const response = await memberDELETE(deleteRequest(), params("user_1"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_admin_required",
    });
  });

  it("fails closed when removing a key-bearing member without rotation grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("user_1", "member");
    await addProductKey("owner_1", 1);
    await addProductKey("user_1", 1);

    const response = await memberDELETE(deleteRequest(), params("user_1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Removing this member requires a rotated space key for remaining members",
      code: "space_key_rotation_required",
    });
    expect(await Bucket.db.collection("member").countDocuments()).toBe(2);
    expect(await SpaceProductKey.countDocuments({ status: "revoked" })).toBe(0);
  });

  it("removes a member, revokes old grants, and stores rotated grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("admin_1", "admin");
    await addMember("user_1", "member");
    await addMember("guest_1", "guest");
    await addProductKey("owner_1", 1);
    await addProductKey("admin_1", 1);
    await addProductKey("user_1", 1);
    await addSession("user_1");
    await Bucket.db.collection("team").insertOne({
      id: "team_1",
      organizationId: "org_1",
      name: "Design",
      createdAt: new Date(),
    });
    await Bucket.db.collection("teamMember").insertOne({
      userId: "user_1",
      teamId: "team_1",
      createdAt: new Date(),
    });

    const response = await memberDELETE(
      deleteRequest({
        rotationGrants: [
          {
            memberUserId: "owner_1",
            wrappedSpaceKey: "rotated-owner",
            keyVersion: 2,
          },
          {
            memberUserId: "admin_1",
            wrappedSpaceKey: "rotated-admin",
            keyVersion: 2,
          },
        ],
      }),
      params("user_1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      removedMemberUserId: "user_1",
      rotated: true,
      keyVersion: 2,
    });
    expect(await Bucket.db.collection("member").countDocuments({
      organizationId: "org_1",
      userId: "user_1",
    })).toBe(0);
    expect(await Bucket.db.collection("teamMember").countDocuments()).toBe(0);
    const removedSession = await Bucket.db.collection("session").findOne({
      id: "session-user_1",
    });
    expect(removedSession?.activeOrganizationId).toBeUndefined();
    expect(removedSession?.activeTeamId).toBeUndefined();
    expect(await SpaceProductKey.countDocuments({
      spaceId: organizationSpaceId("org_1"),
      memberAccountId: "user_1",
      status: "revoked",
    })).toBe(1);
    expect(await SpaceProductKey.countDocuments({
      spaceId: organizationSpaceId("org_1"),
      keyVersion: 2,
      status: "active",
    })).toBe(2);
  });

  it("removes guests without requiring key rotation", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("admin_1", "admin");
    await addMember("guest_1", "guest");

    const response = await memberDELETE(deleteRequest(), params("guest_1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rotated).toBe(false);
    expect(await Bucket.db.collection("member").countDocuments({
      organizationId: "org_1",
      userId: "guest_1",
    })).toBe(0);
  });

  it("does not remove the last owner", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("admin_1", "admin");

    const response = await memberDELETE(deleteRequest(), params("owner_1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Self-removal is not supported by this endpoint",
      code: "self_removal_not_supported",
    });

    mockSession("admin_1");
    const secondResponse = await memberDELETE(deleteRequest(), params("owner_1"));

    expect(secondResponse.status).toBe(403);
    await expect(secondResponse.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_owner_required",
    });
  });
});
