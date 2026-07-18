import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/orgs/[orgId]/keys/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import {
  createTestProductKey,
  SpaceProductKey,
} from "@/tests/helpers/spaceProductKeys";
import { organizationSpaceId, teamSpaceId } from "@xenode/spaces/ids";

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

async function createOrg() {
  await Bucket.db.collection("organization").insertOne({
    id: "org_1",
    name: "Acme",
    slug: "acme",
    createdAt: new Date(),
  });
}

async function addMember(userId: string, role = "member") {
  await Bucket.db.collection("member").insertOne({
    userId,
    organizationId: "org_1",
    role,
    createdAt: new Date(),
  });
}

async function addTeam(teamId = "team_1") {
  await Bucket.db.collection("team").insertOne({
    id: teamId,
    name: "Design",
    organizationId: "org_1",
    createdAt: new Date(),
  });
}

async function addTeamMember(userId: string, teamId = "team_1") {
  await Bucket.db.collection("teamMember").insertOne({
    userId,
    teamId,
    createdAt: new Date(),
  });
}

function params() {
  return { params: Promise.resolve({ orgId: "org_1" }) };
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orgs/org_1/keys", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("organization product keys", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("hides product keys while organizations are disabled", async () => {
    mockSession("user_1");

    const response = await GET(
      new NextRequest("http://localhost/api/orgs/org_1/keys"),
      params(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Organizations are not enabled",
      code: "organizations_not_enabled",
    });
  });

  it("returns only the current member's active wrapped keys", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await createOrg();
    await addMember("user_1", "member");
    await addMember("user_2", "member");
    const spaceId = organizationSpaceId("org_1");
    await createTestProductKey({
      spaceId,
      memberAccountId: "user_1",
      wrappedKey: "wrapped-for-user-1",
      keyVersion: 2,
    });
    await createTestProductKey({
      spaceId,
      memberAccountId: "user_2",
      wrappedKey: "wrapped-for-user-2",
      keyVersion: 2,
    });
    await createTestProductKey({
      spaceId,
      memberAccountId: "user_1",
      wrappedKey: "revoked",
      keyVersion: 1,
      status: "revoked",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/orgs/org_1/keys"),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].wrappedKey).toBe("wrapped-for-user-1");
    expect(body.keys[0].memberAccountId).toBe("user_1");
    expect(body.keys[0].keyVersion).toBe(2);
    expect(body.keys[0].algorithm).toBe("RSA-OAEP-256");
  });

  it("allows owners and admins to store ciphertext keys for org members", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("user_1", "member");

    const response = await POST(
      postRequest({
        memberAccountId: "user_1",
        wrappedKey: "ciphertext-only",
        keyVersion: 1,
        rotationReason: "initial",
      }),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.key.memberAccountId).toBe("user_1");
    expect(body.key.wrappedKey).toBe("ciphertext-only");
    expect(await SpaceProductKey.countDocuments()).toBe(1);
  });

  it("does not let members create product keys", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await createOrg();
    await addMember("user_1", "member");

    const response = await POST(
      postRequest({
        memberAccountId: "user_1",
        wrappedKey: "ciphertext-only",
        keyVersion: 1,
      }),
      params(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_admin_required",
    });
    expect(await SpaceProductKey.countDocuments()).toBe(0);
  });

  it("does not issue product keys to guests", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("guest_1", "guest");

    const response = await POST(
      postRequest({
        memberAccountId: "guest_1",
        wrappedKey: "must-not-persist",
        keyVersion: 1,
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(await SpaceProductKey.countDocuments()).toBe(0);
  });

  it("requires target team membership for team product keys", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1");
    await createOrg();
    await addMember("admin_1", "admin");
    await addMember("user_1", "member");
    await addTeam("team_1");

    const requestBody = {
      memberAccountId: "user_1",
      teamId: "team_1",
      wrappedKey: "team-ciphertext",
      keyVersion: 1,
    };
    const response = await POST(postRequest(requestBody), params());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "team_membership_required",
    });

    await addTeamMember("user_1", "team_1");
    const secondResponse = await POST(postRequest(requestBody), params());

    expect(secondResponse.status).toBe(201);
    expect(
      await SpaceProductKey.countDocuments({
        spaceId: teamSpaceId("org_1", "team_1"),
        memberAccountId: "user_1",
        status: "active",
      }),
    ).toBe(1);
  });
});