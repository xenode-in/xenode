import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/orgs/[orgId]/keys/route";
import { getServerSession } from "@/lib/auth/session";
import OrgKeyGrant from "@/models/OrgKeyGrant";
import Bucket from "@/models/Bucket";

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

describe("organization key grants", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("hides key grants while organizations are disabled", async () => {
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

  it("returns only the current member's active wrapped grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await createOrg();
    await addMember("user_1", "member");
    await addMember("user_2", "member");
    await OrgKeyGrant.create({
      orgId: "org_1",
      teamId: null,
      memberUserId: "user_1",
      wrappedSpaceKey: "wrapped-for-user-1",
      keyVersion: 2,
      wrappedByUserId: "admin_1",
      createdBy: "admin_1",
    });
    await OrgKeyGrant.create({
      orgId: "org_1",
      teamId: null,
      memberUserId: "user_2",
      wrappedSpaceKey: "wrapped-for-user-2",
      keyVersion: 2,
      wrappedByUserId: "admin_1",
      createdBy: "admin_1",
    });
    await OrgKeyGrant.create({
      orgId: "org_1",
      teamId: null,
      memberUserId: "user_1",
      wrappedSpaceKey: "revoked",
      keyVersion: 1,
      wrappedByUserId: "admin_1",
      createdBy: "admin_1",
      revokedAt: new Date(),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/orgs/org_1/keys"),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0].wrappedSpaceKey).toBe("wrapped-for-user-1");
    expect(body.grants[0].keyVersion).toBe(2);
  });

  it("allows owners and admins to store ciphertext grants for org members", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("user_1", "member");

    const response = await POST(
      postRequest({
        memberUserId: "user_1",
        wrappedSpaceKey: "ciphertext-only",
        keyVersion: 1,
        rotationReason: "initial",
      }),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.grant.memberUserId).toBe("user_1");
    expect(body.grant.wrappedSpaceKey).toBe("ciphertext-only");
    expect(await OrgKeyGrant.countDocuments()).toBe(1);
  });

  it("does not let members create grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await createOrg();
    await addMember("user_1", "member");

    const response = await POST(
      postRequest({
        memberUserId: "user_1",
        wrappedSpaceKey: "ciphertext-only",
        keyVersion: 1,
      }),
      params(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_admin_required",
    });
    expect(await OrgKeyGrant.countDocuments()).toBe(0);
  });

  it("requires target team membership for team key grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1");
    await createOrg();
    await addMember("admin_1", "admin");
    await addMember("user_1", "member");
    await addTeam("team_1");

    const response = await POST(
      postRequest({
        memberUserId: "user_1",
        teamId: "team_1",
        wrappedSpaceKey: "team-ciphertext",
        keyVersion: 1,
      }),
      params(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "team_membership_required",
    });

    await addTeamMember("user_1", "team_1");
    const secondResponse = await POST(
      postRequest({
        memberUserId: "user_1",
        teamId: "team_1",
        wrappedSpaceKey: "team-ciphertext",
        keyVersion: 1,
      }),
      params(),
    );

    expect(secondResponse.status).toBe(201);
    expect(await OrgKeyGrant.countDocuments({ teamId: "team_1" })).toBe(1);
  });
});
