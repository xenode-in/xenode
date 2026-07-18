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

  it("returns the single shared system bucket", async () => {
    // Buckets were consolidated into one system bucket; GET returns exactly it.
    mockSession("user_1");

    const response = await GET(request("http://localhost/api/buckets"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0].systemKey).toBe("drive");
  });

  it("rejects custom bucket creation with 410", async () => {
    // Physical buckets are now system-managed; POST is no longer supported.
    mockSession("user_1");

    const response = await POST(
      request("http://localhost/api/buckets", {
        method: "POST",
        body: JSON.stringify({ name: "docs" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "Custom buckets are no longer supported",
      code: "system_bucket_only",
    });
    expect(createB2Bucket).not.toHaveBeenCalled();
  });

  it("returns the system bucket regardless of a legacy scope query param", async () => {
    // The old ?scope=organization 501 path is gone; the route serves the
    // single system bucket and ignores the legacy query param.
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

    expect(response.status).toBe(200);
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0].systemKey).toBe("drive");
  });
});
