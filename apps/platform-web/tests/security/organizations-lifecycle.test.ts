import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as orgsGET, POST as orgsPOST } from "@/app/api/orgs/route";
import { GET as membersGET } from "@/app/api/orgs/[orgId]/members/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import { SpaceProductKey } from "@/tests/helpers/spaceProductKeys";
import { organizationSpaceId } from "@xenode/spaces/ids";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "user_1", activeOrganizationId?: string | null) {
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
      activeOrganizationId,
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function insertOrg(args: {
  id: string;
  name?: string;
  slug?: string;
}) {
  await Bucket.db.collection("organization").insertOne({
    id: args.id,
    name: args.name ?? args.id,
    slug: args.slug ?? args.id,
    logo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function insertMember(args: {
  orgId: string;
  userId: string;
  role?: string;
}) {
  await Bucket.db.collection("member").insertOne({
    id: `mem_${args.orgId}_${args.userId}`,
    organizationId: args.orgId,
    userId: args.userId,
    role: args.role ?? "member",
    createdAt: new Date(),
  });
}

async function insertUser(userId: string, email = `${userId}@example.com`) {
  await Bucket.db.collection("user").insertOne({
    id: userId,
    email,
    name: `User ${userId}`,
    image: null,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function orgPost(body: unknown) {
  return new NextRequest("http://localhost/api/orgs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function orgParams(orgId = "org_1") {
  return { params: Promise.resolve({ orgId }) };
}

describe("organization lifecycle API", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("is hidden while organizations are disabled", async () => {
    mockSession("user_1");

    const response = await orgsGET(new NextRequest("http://localhost/api/orgs"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Organizations are not enabled",
      code: "organizations_not_enabled",
    });
  });

  it("creates an owner org and optional owner-wrapped initial space key", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");

    const response = await orgsPOST(
      orgPost({
        name: "Acme Labs",
        orgType: "company",
        teamSize: "1-10",
        ownerWrappedSpaceKey: "wrapped-for-owner",
        keyVersion: 1,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.organization.name).toBe("Acme Labs");
    expect(body.organization.slug).toBe("acme-labs");
    expect(body.organization.role).toBe("owner");
    expect(body.spaceKeyReady).toBe(true);
    expect(body.defaultBucketReady).toBe(true);

    const org = await Bucket.db.collection("organization").findOne({
      id: body.organization.id,
    });
    const member = await Bucket.db.collection("member").findOne({
      organizationId: body.organization.id,
      userId: "owner_1",
    });

    expect(org?.slug).toBe("acme-labs");
    expect(member?.role).toBe("owner");
    await expect(Bucket.countDocuments({
      userId: "system",
      name: "xenode-organization-dev",
      b2BucketId: "xenode-organization-dev",
    })).resolves.toBe(1);
    expect(await SpaceProductKey.countDocuments({
      spaceId: organizationSpaceId(body.organization.id),
      memberAccountId: "owner_1",
      ciphertext: "wrapped-for-owner",
      algorithm: "RSA-OAEP-256",
      status: "active",
    })).toBe(1);
  });

  it("rejects duplicate org slugs", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await insertOrg({ id: "org_existing", name: "Acme Labs", slug: "acme-labs" });

    const response = await orgsPOST(
      orgPost({ name: "Acme Labs", orgType: "company", teamSize: "1-10" }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Organization slug is already taken" });
    expect(await Bucket.db.collection("organization").countDocuments()).toBe(1);
  });

  it("lists only the caller's organizations and marks the active org", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1", "org_2");
    await insertOrg({ id: "org_1", name: "One", slug: "one" });
    await insertOrg({ id: "org_2", name: "Two", slug: "two" });
    await insertOrg({ id: "org_3", name: "Three", slug: "three" });
    await insertMember({ orgId: "org_1", userId: "user_1", role: "member" });
    await insertMember({ orgId: "org_2", userId: "user_1", role: "admin" });
    await insertMember({ orgId: "org_3", userId: "user_2", role: "owner" });

    const response = await orgsGET(new NextRequest("http://localhost/api/orgs"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organizations.map((org: { id: string }) => org.id).sort()).toEqual([
      "org_1",
      "org_2",
    ]);
    expect(
      body.organizations.find((org: { id: string }) => org.id === "org_2")
        .isActive,
    ).toBe(true);
  });

  it("lists members with user profile fields for non-guest members", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1", "org_1");
    await insertOrg({ id: "org_1", name: "Acme", slug: "acme" });
    await insertMember({ orgId: "org_1", userId: "admin_1", role: "admin" });
    await insertMember({ orgId: "org_1", userId: "user_1", role: "member" });
    await insertUser("admin_1", "admin@example.com");
    await insertUser("user_1", "user@example.com");

    const response = await membersGET(
      new NextRequest("http://localhost/api/orgs/org_1/members"),
      orgParams("org_1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.members).toHaveLength(2);
    expect(
      body.members.find((member: { userId: string }) => member.userId === "user_1")
        .user.email,
    ).toBe("user@example.com");
  });

  it("does not let guests list the org roster", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1", "org_1");
    await insertOrg({ id: "org_1", name: "Acme", slug: "acme" });
    await insertMember({ orgId: "org_1", userId: "guest_1", role: "guest" });

    const response = await membersGET(
      new NextRequest("http://localhost/api/orgs/org_1/members"),
      orgParams("org_1"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_role_required",
    });
  });
});
