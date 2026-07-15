import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as teamsGET, POST as teamsPOST } from "@/app/api/orgs/[orgId]/teams/route";
import { DELETE as teamDELETE } from "@/app/api/orgs/[orgId]/teams/[teamId]/route";
import { POST as teamMemberPOST } from "@/app/api/orgs/[orgId]/teams/[teamId]/members/route";
import { DELETE as teamMemberDELETE } from "@/app/api/orgs/[orgId]/teams/[teamId]/members/[memberUserId]/route";
import { POST as teamCompletePOST } from "@/app/api/orgs/[orgId]/teams/[teamId]/objects/complete-upload/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { SpaceProductKey } from "@/tests/helpers/spaceProductKeys";
import { teamSpaceId } from "@xenode/spaces/ids";
import OrgUsage from "@/models/OrgUsage";
import mongoose from "mongoose";

vi.mock("@/lib/b2/client", () => ({
  getS3Client: vi.fn(() => ({ send: vi.fn(async () => ({ VersionId: "b2-v1" })) })),
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
  await mongoose.connection.collection("organization").insertOne({
    id,
    name: "Acme",
    slug: id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function addOrgMember(userId: string, role = "member", orgId = "org_1") {
  await mongoose.connection.collection("member").insertOne({
    id: `mem_${orgId}_${userId}`,
    userId,
    organizationId: orgId,
    role,
    createdAt: new Date(),
  });
}

function req(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

function teamParams(teamId: string, orgId = "org_1") {
  return { params: Promise.resolve({ orgId, teamId }) };
}

async function createTeam(name = "Engineering", orgId = "org_1") {
  const res = await teamsPOST(
    req(`/api/orgs/${orgId}/teams`, {
      name,
      ownerWrappedTeamKey: "wrapped-team-key",
      keyVersion: 1,
    }),
    { params: Promise.resolve({ orgId }) },
  );
  const body = await res.json();
  return { res, body };
}

describe("organization teams & team drives", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("lets an owner create a team with owner team key grant", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");

    const { res, body } = await createTeam();
    expect(res.status).toBe(201);
    const teamId = body.team.id;

    await expect(
      mongoose.connection.collection("teamMember").countDocuments({ teamId, userId: "owner_1" }),
    ).resolves.toBe(1);
    await expect(
      Bucket.countDocuments({ ownerScope: "team", orgId: "org_1", teamId, name: "workspace" }),
    ).resolves.toBe(0);
    await expect(
      SpaceProductKey.countDocuments({
        spaceId: teamSpaceId("org_1", teamId),
        memberAccountId: "owner_1",
        status: "active",
      }),
    ).resolves.toBe(1);
  });

  it("forbids non-admins from creating teams", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addOrgMember("member_1", "member");

    const { res } = await createTeam();
    expect(res.status).toBe(403);
  });

  it("adds an org member to a team with a team key grant", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");
    await addOrgMember("member_2", "member");
    const { body } = await createTeam();
    const teamId = body.team.id;

    const res = await teamMemberPOST(
      req(`/api/orgs/org_1/teams/${teamId}/members`, {
        memberUserId: "member_2",
        wrappedTeamKey: "wrapped-for-member2",
        keyVersion: 1,
      }),
      teamParams(teamId),
    );
    expect(res.status).toBe(201);
    await expect(
      SpaceProductKey.countDocuments({
        spaceId: teamSpaceId("org_1", teamId),
        memberAccountId: "member_2",
        status: "active",
      }),
    ).resolves.toBe(1);
  });

  it("rejects adding a non-org-member to a team", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");
    const { body } = await createTeam();
    const teamId = body.team.id;

    const res = await teamMemberPOST(
      req(`/api/orgs/org_1/teams/${teamId}/members`, {
        memberUserId: "stranger",
        wrappedTeamKey: "k",
        keyVersion: 1,
      }),
      teamParams(teamId),
    );
    expect(res.status).toBe(400);
  });

  it("requires a rotated team key when removing a member with remaining members", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");
    await addOrgMember("member_2", "member");
    const { body } = await createTeam();
    const teamId = body.team.id;
    await teamMemberPOST(
      req(`/api/orgs/org_1/teams/${teamId}/members`, {
        memberUserId: "member_2",
        wrappedTeamKey: "k",
        keyVersion: 1,
      }),
      teamParams(teamId),
    );

    // Remove member_2 without rotationGrants for the remaining owner → 400.
    const res = await teamMemberDELETE(
      req(`/api/orgs/org_1/teams/${teamId}/members/member_2`, {}),
      { params: Promise.resolve({ orgId: "org_1", teamId, memberUserId: "member_2" }) },
    );
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.code).toBe("team_key_rotation_required");
  });

  it("finalizes a space-wrapped team object and rolls it up to OrgUsage", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");
    const { body } = await createTeam();
    const teamId = body.team.id;
    const bucket = await Bucket.create({
      userId: "system",
      ownerScope: "organization",
      name: "xenode-organization-dev",
      b2BucketId: "xenode-organization-dev",
    });

    const res = await teamCompletePOST(
      req(`/api/orgs/org_1/teams/${teamId}/objects/complete-upload`, {
        bucketId: bucket._id.toString(),
        objectKey: `workspaces/org_1/teams/${teamId}/objects/file.bin`,
        size: 500,
        contentType: "text/plain",
        isEncrypted: true,
        wrappedBy: "space",
        encryptedDEK: "team-wrapped-dek",
        spaceKeyVersion: 1,
      }),
      teamParams(teamId),
    );
    expect(res.status).toBe(201);

    const obj = await StorageObject.findOne({ ownerScope: "team", teamId }).lean();
    expect(obj?.orgId).toBe("org_1");
    expect(obj?.userId).toBe("org:org_1");

    const usage = await OrgUsage.findOne({ orgId: "org_1" }).lean();
    expect(usage?.totalStorageBytes).toBe(500);
  });

  it("deletes a team and cleans up members, buckets, objects, and grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");
    const { body } = await createTeam();
    const teamId = body.team.id;

    const res = await teamDELETE(
      req(`/api/orgs/org_1/teams/${teamId}`),
      teamParams(teamId),
    );
    expect(res.status).toBe(200);

    await expect(
      mongoose.connection.collection("team").countDocuments({ id: teamId }),
    ).resolves.toBe(0);
    await expect(
      mongoose.connection.collection("teamMember").countDocuments({ teamId }),
    ).resolves.toBe(0);
    await expect(
      Bucket.countDocuments({ ownerScope: "team", teamId }),
    ).resolves.toBe(0);
    await expect(
      SpaceProductKey.countDocuments({ spaceId: teamSpaceId("org_1", teamId) }),
    ).resolves.toBe(0);
  });

  it("lists teams with membership + counts", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addOrgMember("owner_1", "owner");
    await createTeam("Engineering");
    await createTeam("Design");

    const res = await teamsGET(
      new NextRequest("http://localhost/api/orgs/org_1/teams"),
      { params: Promise.resolve({ orgId: "org_1" }) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.teams).toHaveLength(2);
    expect(body.teams.every((t: { isMember: boolean }) => t.isMember)).toBe(true);
    expect(body.teams.every((t: { memberCount: number }) => t.memberCount === 1)).toBe(true);
  });
});
