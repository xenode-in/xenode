import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as notifGET, PATCH as notifPATCH } from "@/app/api/notifications/route";
import {
  GET as reqGET,
  POST as reqPOST,
} from "@/app/api/orgs/[orgId]/access-requests/route";
import { PATCH as reqPATCH } from "@/app/api/orgs/[orgId]/access-requests/[requestId]/route";
import { getServerSession } from "@/lib/auth/session";
import { emitNotification } from "@/lib/notifications/emit";
import { enforceRateLimit } from "@/lib/ratelimit/limiter";
import Notification from "@/models/Notification";
import AccessRequest from "@/models/AccessRequest";
import mongoose from "mongoose";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId: string) {
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

function jsonReq(url: string, method = "GET", bodyObj?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(bodyObj === undefined
      ? {}
      : { body: JSON.stringify(bodyObj), headers: { "content-type": "application/json" } }),
  });
}

const orgParams = (orgId = "org_1") => ({ params: Promise.resolve({ orgId }) });

describe("notifications, access requests, rate limiting", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("lists notifications with unread count and marks them read", async () => {
    mockSession("user_1");
    await emitNotification({ userId: "user_1", type: "invite_received", title: "One" });
    await emitNotification({ userId: "user_1", type: "role_changed", title: "Two" });
    await emitNotification({ userId: "other", type: "role_changed", title: "Not mine" });

    const listed = await notifGET(jsonReq("/api/notifications"));
    const body = await listed.json();
    expect(listed.status).toBe(200);
    expect(body.items).toHaveLength(2); // scoped to user_1
    expect(body.unreadCount).toBe(2);

    const marked = await notifPATCH(jsonReq("/api/notifications", "PATCH", { all: true }));
    const markedBody = await marked.json();
    expect(markedBody.unreadCount).toBe(0);
    await expect(
      Notification.countDocuments({ userId: "user_1", read: false }),
    ).resolves.toBe(0);
  });

  it("strips PII from notification metadata", async () => {
    await emitNotification({
      userId: "user_1",
      type: "invite_received",
      title: "X",
      metadata: { role: "member", email: "leak@example.com" },
    });
    const n = await Notification.findOne({ userId: "user_1" }).lean();
    expect(n?.metadata.role).toBe("member");
    expect(n?.metadata.email).toBeUndefined();
  });

  it("routes access requests: notify admins, member sees own, admin triages", async () => {
    process.env.ORGS_ENABLED = "true";
    await createOrg();
    await addMember("admin_1", "admin");
    await addMember("member_2", "member");

    // Member submits a request.
    mockSession("member_2");
    const created = await reqPOST(
      jsonReq("/api/orgs/org_1/access-requests", "POST", {
        resourceType: "object",
        resourceId: "obj_123",
        note: "need this",
      }),
      orgParams(),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const requestId = createdBody.request.id;

    // Admin was notified.
    await expect(
      Notification.countDocuments({ userId: "admin_1", type: "access_request" }),
    ).resolves.toBe(1);

    // Member sees only their own, cannot triage.
    const memberList = await reqGET(jsonReq("/api/orgs/org_1/access-requests"), orgParams());
    const memberBody = await memberList.json();
    expect(memberBody.canTriage).toBe(false);
    expect(memberBody.requests).toHaveLength(1);

    // Admin sees it and can triage.
    mockSession("admin_1");
    const adminList = await reqGET(jsonReq("/api/orgs/org_1/access-requests"), orgParams());
    const adminBody = await adminList.json();
    expect(adminBody.canTriage).toBe(true);
    expect(adminBody.requests).toHaveLength(1);

    // Admin approves → requester notified, status updated.
    const decided = await reqPATCH(
      jsonReq(`/api/orgs/org_1/access-requests/${requestId}`, "PATCH", { decision: "approve" }),
      { params: Promise.resolve({ orgId: "org_1", requestId }) },
    );
    expect(decided.status).toBe(200);
    const req = await AccessRequest.findById(requestId).lean();
    expect(req?.status).toBe("approved");
    await expect(
      Notification.countDocuments({ userId: "member_2", type: "access_request_decided" }),
    ).resolves.toBe(1);
  });

  it("enforces the rate limit after the threshold", async () => {
    await enforceRateLimit({ key: "test:u1", limit: 2, windowMs: 60_000 });
    await enforceRateLimit({ key: "test:u1", limit: 2, windowMs: 60_000 });
    await expect(
      enforceRateLimit({ key: "test:u1", limit: 2, windowMs: 60_000 }),
    ).rejects.toThrow();

    // A different key is unaffected.
    await expect(
      enforceRateLimit({ key: "test:u2", limit: 2, windowMs: 60_000 }),
    ).resolves.toBeUndefined();
  });
});
