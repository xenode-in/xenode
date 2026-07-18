import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as driveConfigGET } from "@/app/api/drive/config/route";
import { GET as filesSyncGET } from "@/app/api/files/sync/route";
import { GET as usageGET } from "@/app/api/usage/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import { ensureOrganizationSpace } from "@xenode/spaces/repository";

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

async function addOrgMember(userId = "user_1") {
  await Bucket.db.collection("member").insertOne({
    userId,
    organizationId: "org_1",
    role: "admin",
    createdAt: new Date(),
  });
}

async function seedOrgAccess(userId = "user_1") {
  await addOrgMember(userId);
  await ensureOrganizationSpace({ accountId: userId, organizationId: "org_1" });
}

function orgRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "x-xenode-space-id": "space_org_org_1" },
  });
}

describe("organization storage support route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("serves org drive config from the shared system bucket under the org prefix", async () => {
    // Org storage is now wired: the request resolves against the org Space and
    // returns the single shared system bucket plus the immutable org key prefix.
    // The old "fail closed / organization_storage_not_ready" path is gone.
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await seedOrgAccess("user_1");

    const response = await driveConfigGET(orgRequest("/api/drive/config"));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.rootPrefix).toBe("workspaces/org_1/objects/");
    expect(body.bucket?.systemKey).toBe("drive");
  });

  it("reports org usage scoped to the org space (no personal objects leak in)", async () => {
    // Usage is metered under org scope now (200), and because no objects exist in
    // the org space the category breakdown is empty rather than failing closed.
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await seedOrgAccess("user_1");

    const response = await usageGET(orgRequest("/api/usage"));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.breakdown).toEqual([]);
  });

  it("serves org file sync scoped to the org space (empty delta with no org files)", async () => {
    // File sync resolves the org Space and returns objects scoped by spaceId.
    // With no org-space objects the delta is empty; it no longer fails closed.
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await seedOrgAccess("user_1");

    const response = await filesSyncGET(orgRequest("/api/files/sync"));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.files).toEqual([]);
  });
});
