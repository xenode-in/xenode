import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createB2Bucket } = vi.hoisted(() => ({
  createB2Bucket: vi.fn(async (name: string) => `b2-${name}`),
}));

vi.mock("@/lib/b2/buckets", () => ({
  createB2Bucket,
  deleteB2Bucket: vi.fn(),
}));

import { GET, POST } from "@/app/api/buckets/route";
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

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

describe("organization route adoption", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    createB2Bucket.mockClear();
    mockedGetServerSession.mockReset();
  });

  it("keeps bucket listing scoped to the personal user by default", async () => {
    mockSession("user_1");
    await Bucket.create({
      userId: "user_1",
      name: "mine",
      b2BucketId: "b2-mine",
    });
    await Bucket.create({
      userId: "user_2",
      name: "theirs",
      b2BucketId: "b2-theirs",
    });
    await Bucket.create({
      userId: "system",
      name: "system",
      b2BucketId: "b2-system",
    });

    const response = await GET(request("http://localhost/api/buckets"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0].name).toBe("mine");
  });

  it("creates personal buckets with scope metadata", async () => {
    mockSession("user_1");

    const response = await POST(
      request("http://localhost/api/buckets", {
        method: "POST",
        body: JSON.stringify({ name: "docs" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.bucket.ownerScope).toBe("personal");
    expect(body.bucket.createdBy).toBe("user_1");
    expect(createB2Bucket).toHaveBeenCalledWith("xn-user_1-docs");
  });

  it("fails closed for explicit org bucket access until storage policy is enabled", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await Bucket.db.collection("member").insertOne({
      userId: "user_1",
      organizationId: "org_1",
      role: "admin",
      createdAt: new Date(),
    });

    const response = await GET(
      request("http://localhost/api/buckets?scope=organization"),
    );
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toEqual({
      error: "Organization storage is not enabled yet",
      code: "organization_storage_not_ready",
    });
  });
});
