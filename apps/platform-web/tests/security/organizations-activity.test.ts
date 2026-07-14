import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as activityGET } from "@/app/api/orgs/[orgId]/activity/route";
import { getServerSession } from "@/lib/auth/session";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import ActivityLog from "@/models/ActivityLog";
import mongoose from "mongoose";

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

async function addMember(userId: string, role = "member", orgId = "org_1") {
  await mongoose.connection.collection("member").insertOne({
    id: `mem_${orgId}_${userId}`,
    userId,
    organizationId: orgId,
    role,
    createdAt: new Date(),
  });
}

function params(orgId = "org_1") {
  return { params: Promise.resolve({ orgId }) };
}

function req(query = "") {
  return new NextRequest(`http://localhost/api/orgs/org_1/activity${query}`);
}

describe("organization activity log", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("emitActivity persists a row and strips PII from metadata", async () => {
    await emitActivity({
      orgId: "org_1",
      action: ActivityAction.MEMBER_INVITED,
      actorUserId: "owner_1",
      target: { type: "invitation", id: "inv_1" },
      metadata: { role: "member", email: "secret@example.com" },
    });

    const row = await ActivityLog.findOne({ orgId: "org_1" }).lean();
    expect(row?.action).toBe("member.invited");
    expect(row?.metadata.role).toBe("member");
    expect(row?.metadata.email).toBeUndefined(); // PII stripped
  });

  it("returns org activity newest-first for a member", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    await emitActivity({ orgId: "org_1", action: "member.joined", actorUserId: "a" });
    await emitActivity({ orgId: "org_1", action: "file.uploaded", actorUserId: "b" });

    const res = await activityGET(req(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].action).toBe("file.uploaded"); // newest first
    expect(body.nextCursor).toBeNull();
  });

  it("forbids guests from reading the activity feed", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1");
    await createOrg();
    await addMember("guest_1", "guest");
    await emitActivity({ orgId: "org_1", action: "member.joined", actorUserId: "a" });

    const res = await activityGET(req(), params());
    expect(res.status).toBe(403);
  });

  it("paginates with a cursor", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    for (let i = 0; i < 5; i += 1) {
      await emitActivity({ orgId: "org_1", action: "file.uploaded", actorUserId: "a" });
    }

    const first = await activityGET(req("?limit=2"), params());
    const firstBody = await first.json();
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await activityGET(
      req(`?limit=2&cursor=${firstBody.nextCursor}`),
      params(),
    );
    const secondBody = await second.json();
    expect(secondBody.items).toHaveLength(2);
    // No overlap between pages.
    const firstIds = new Set(firstBody.items.map((i: { id: string }) => i.id));
    expect(secondBody.items.some((i: { id: string }) => firstIds.has(i.id))).toBe(
      false,
    );
  });

  it("filters by action and scopes to the org", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");
    await emitActivity({ orgId: "org_1", action: "member.joined", actorUserId: "a" });
    await emitActivity({ orgId: "org_1", action: "file.uploaded", actorUserId: "a" });
    await emitActivity({ orgId: "org_2", action: "file.uploaded", actorUserId: "x" });

    const res = await activityGET(req("?action=file.uploaded"), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1); // only org_1's file.uploaded
    expect(body.items[0].action).toBe("file.uploaded");
  });
});
