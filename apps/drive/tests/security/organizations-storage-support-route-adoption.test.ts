import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as driveConfigGET } from "@/app/api/drive/config/route";
import { GET as filesSyncGET } from "@/app/api/files/sync/route";
import { GET as usageGET } from "@/app/api/usage/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import OrgUsage from "@/models/OrgUsage";
import StorageObject from "@/models/StorageObject";
import Usage from "@/models/Usage";
import { storageCacheKey } from "@/lib/realtime/cache-keys";
import { withRedis } from "@/lib/redis";
import {
  ensureOrganizationSpace,
  ensurePersonalSpace,
} from "@xenode/spaces/repository";

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

/** A developer Redis may be running; never let a cached usage body leak between cases. */
async function clearUsageCache(spaceId: string) {
  await withRedis((redis) => redis.del(storageCacheKey(spaceId)));
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
    await OrgUsage.create({
      orgId: "org_1",
      accountId: "org:org_1",
      totalStorageBytes: 4096,
      totalObjects: 3,
      storageLimitBytes: 1024 * 1024,
    });
    await Usage.create({ userId: "user_1", totalStorageBytes: 7, storageLimitBytes: 10 });
    await clearUsageCache("space_org_org_1");

    const response = await usageGET(orgRequest("/api/usage"));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.breakdown).toEqual([]);
    // Totals come from the organization owner, never the member's own Usage.
    expect(body).toMatchObject({
      totalStorageBytes: 4096,
      totalObjects: 3,
      storageLimitBytes: 1024 * 1024,
    });
  });

  it("reports personal usage read-only from the authoritative counters", async () => {
    mockSession("user_1");
    await ensurePersonalSpace("user_1");
    await Usage.create({
      userId: "user_1",
      totalStorageBytes: 500,
      totalObjects: 4,
      storageLimitBytes: 10_000,
    });
    await clearUsageCache("space_personal_user_1");
    // Objects disagree with the counter (for example a commit landed after a
    // scan); the counter is authoritative and must not be overwritten.
    await StorageObject.collection.insertOne({
      productId: "drive",
      spaceId: "space_personal_user_1",
      key: "users/user_1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      size: 100,
      mediaCategory: "image",
    });

    const response = await usageGET(new NextRequest("http://localhost/api/usage"));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ totalStorageBytes: 500, totalObjects: 4 });
    expect(body.breakdown).toEqual([{ category: "Images", bytes: 100, count: 1 }]);
    const usage = await Usage.findOne({ userId: "user_1" }).lean();
    expect(usage?.totalStorageBytes).toBe(500);
    expect(usage?.totalObjects).toBe(4);
  });

  it("fails closed instead of creating usage or plan state", async () => {
    mockSession("user_2");
    await ensurePersonalSpace("user_2");
    await clearUsageCache("space_personal_user_2");

    const response = await usageGET(new NextRequest("http://localhost/api/usage"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "usage_not_initialized" });
    expect(await Usage.countDocuments({ userId: "user_2" })).toBe(0);
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
    expect(body.changes).toEqual([]);
    expect(body.spaceId).toBe("space_org_org_1");
    expect(body.reset).toBe(true);
    expect(typeof body.cursor).toBe("string");
  });
});
