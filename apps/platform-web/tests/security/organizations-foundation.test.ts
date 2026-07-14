import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "@/lib/auth/session";
import { getAccessContext, type AccessContext } from "@/lib/authz/context";
import { objectOwnershipClause } from "@/lib/authz/policy";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(overrides: Record<string, unknown> = {}) {
  mockedGetServerSession.mockResolvedValue({
    user: {
      id: "user_1",
      email: "user@example.com",
      name: "User One",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: "session_1",
      userId: "user_1",
      token: "session-token",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      activeOrganizationId: "org_1",
      activeTeamId: "team_1",
      ...overrides,
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

function request(url: string, headers?: HeadersInit) {
  return new NextRequest(url, { headers });
}

describe("organization authz foundation", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("keeps existing requests in personal scope by default", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession();

    const ctx = await getAccessContext(
      request("http://localhost/api/objects"),
    );

    expect(ctx?.scope).toEqual({ type: "personal", userId: "user_1" });
  });

  it("ignores explicit org scope while the feature flag is off", async () => {
    mockSession();

    const ctx = await getAccessContext(
      request("http://localhost/api/objects?scope=organization"),
    );

    expect(ctx?.scope).toEqual({ type: "personal", userId: "user_1" });
  });

  it("resolves explicit organization scope from the active org membership", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession();
    await mongoose.connection.collection("member").insertOne({
      userId: "user_1",
      organizationId: "org_1",
      role: "admin",
      createdAt: new Date(),
    });

    const ctx = await getAccessContext(
      request("http://localhost/api/objects?scope=organization"),
    );

    expect(ctx?.scope).toEqual({
      type: "organization",
      userId: "user_1",
      orgId: "org_1",
      role: "admin",
    });
  });

  it("resolves explicit team scope only with team membership", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession();
    await mongoose.connection.collection("member").insertOne({
      userId: "user_1",
      organizationId: "org_1",
      role: "manager",
      createdAt: new Date(),
    });
    await mongoose.connection.collection("team").insertOne({
      id: "team_1",
      organizationId: "org_1",
      name: "Design",
      createdAt: new Date(),
    });
    await mongoose.connection.collection("teamMember").insertOne({
      userId: "user_1",
      teamId: "team_1",
      createdAt: new Date(),
    });

    const ctx = await getAccessContext(
      request("http://localhost/api/objects", {
        "x-xenode-drive-scope": "team",
        "x-xenode-team-id": "team_1",
      }),
    );

    expect(ctx?.scope).toEqual({
      type: "team",
      userId: "user_1",
      orgId: "org_1",
      teamId: "team_1",
      role: "manager",
    });
  });

  it("fails closed for org storage filters until storage schemas are migrated", () => {
    const ctx: AccessContext = {
      userId: "user_1",
      scope: {
        type: "organization",
        userId: "user_1",
        orgId: "org_1",
        role: "admin",
      },
      session: {} as AccessContext["session"],
    };

    expect(() => objectOwnershipClause(ctx)).toThrow(
      "Organization storage is not enabled yet",
    );
  });
});
