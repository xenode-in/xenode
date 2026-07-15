import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as driveConfigGET } from "@/app/api/drive/config/route";
import { GET as filesSyncGET } from "@/app/api/files/sync/route";
import { GET as usageGET } from "@/app/api/usage/route";
import { getServerSession } from "@/lib/auth/session";
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

async function addOrgMember(userId = "user_1") {
  await Bucket.db.collection("member").insertOne({
    userId,
    organizationId: "org_1",
    role: "admin",
    createdAt: new Date(),
  });
}

function orgRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "x-xenode-space-id": "space_org_org_1" },
  });
}

async function expectOrgStorageClosed(response: Response) {
  expect(response.status).toBe(501);
  await expect(response.json()).resolves.toEqual({
    error: "Organization storage is not enabled yet",
    code: "organization_storage_not_ready",
  });
}

describe("organization storage support route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("fails closed for explicit org drive config until org storage config exists", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await addOrgMember("user_1");

    await expectOrgStorageClosed(
      await driveConfigGET(orgRequest("/api/drive/config")),
    );
  });

  it("fails closed for explicit org usage until org metering exists", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await addOrgMember("user_1");

    await expectOrgStorageClosed(await usageGET(orgRequest("/api/usage")));
  });

  it("fails closed for explicit org file sync until org sync is enabled", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await addOrgMember("user_1");

    await expectOrgStorageClosed(
      await filesSyncGET(orgRequest("/api/files/sync")),
    );
  });
});
