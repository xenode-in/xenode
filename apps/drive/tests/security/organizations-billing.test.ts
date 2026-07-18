import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as checkoutPOST } from "@/app/api/orgs/[orgId]/billing/subscriptions/create/route";
import { POST as invitePOST } from "@/app/api/orgs/[orgId]/invitations/route";
import { getServerSession } from "@/lib/auth/session";
import { syncOrgSubscriptionState } from "@/lib/orgs/billing/service";
import {
  incrementOrgStorage,
  getOrCreateOrgUsage,
} from "@/lib/orgs/billing/orgUsage";
import Subscription from "@/models/Subscription";
import OrgUsage from "@/models/OrgUsage";
import mongoose from "mongoose";

const razorpayCreate = vi.fn(async (_payload: unknown) => ({
  id: "sub_test_1",
  short_url: "https://rzp.example/sub_test_1",
}));

vi.mock("@/lib/razorpay", () => ({
  default: {
    subscriptions: {
      create: (payload: unknown) => razorpayCreate(payload),
      update: vi.fn(async () => ({ id: "sub_test_1" })),
    },
  },
}));

// Email is fire-and-forget; stub it so invite tests don't touch Resend.
vi.mock("@/lib/email/notifications", () => ({
  notifyOrganizationInvitation: vi.fn(async () => {}),
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

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
}

describe("organization billing & seats", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    razorpayCreate.mockClear();
    mockedGetServerSession.mockReset();
  });

  it("lets an owner start org checkout with accountId + seat quantity", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");

    const res = await checkoutPOST(
      request("/api/orgs/org_1/billing/subscriptions/create", {
        planSlug: "org-team",
        billingCycle: "monthly",
        seats: 5,
      }),
      params(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.subscriptionId).toBe("sub_test_1");
    expect(body.seats).toBe(5);
    expect(razorpayCreate).toHaveBeenCalledTimes(1);
    const payload = razorpayCreate.mock.calls[0][0] as {
      quantity: number;
      notes: Record<string, string>;
    };
    expect(payload.quantity).toBe(5);
    expect(payload.notes.accountId).toBe("org:org_1");
    expect(payload.notes.orgId).toBe("org_1");
  });

  it("forbids non-admins from starting org checkout", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1");
    await createOrg();
    await addMember("member_1", "member");

    const res = await checkoutPOST(
      request("/api/orgs/org_1/billing/subscriptions/create", {
        planSlug: "org-team",
        billingCycle: "monthly",
        seats: 5,
      }),
      params(),
    );

    expect(res.status).toBe(403);
    expect(razorpayCreate).not.toHaveBeenCalled();
  });

  it("blocks member invites once the seat limit is reached", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    // One purchased seat, already consumed by the owner.
    await OrgUsage.create({ orgId: "org_1", seats: 1, seatsUsed: 1 });

    const res = await invitePOST(
      request("/api/orgs/org_1/invitations", {
        email: "new@example.com",
        role: "member",
        recipientUserId: "user_x",
        wrappedSpaceKey: "wrapped",
        keyVersion: 1,
      }),
      params(),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("seat_limit_reached");
  });

  it("syncOrgSubscriptionState is the single writer of OrgUsage plan/limit/seats", async () => {
    const sub = await Subscription.create({
      userId: "owner_1",
      accountId: "org:org_1",
      planSlug: "org-team",
      status: "active",
      billingCycle: "monthly",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 86400_000),
      autoRenew: true,
      metadata: { basePlanAmount: 99900 },
    });

    await syncOrgSubscriptionState({
      orgId: "org_1",
      subscriptionDocId: sub._id,
      status: "active",
      expiresAt: new Date(Date.now() + 30 * 86400_000),
      autopayActive: true,
      seats: 25,
    });

    const usage = await OrgUsage.findOne({ orgId: "org_1" }).lean();
    expect(usage?.plan).toBe("org-team");
    expect(usage?.storageLimitBytes).toBe(1024 * 1024 * 1024 * 1024); // 1 TB
    expect(usage?.seats).toBe(25);
    expect(usage?.accountId).toBe("org:org_1");
    expect(usage?.autopayActive).toBe(true);
  });

  it("enforces the org storage ceiling atomically", async () => {
    await getOrCreateOrgUsage("org_1");
    await OrgUsage.updateOne(
      { orgId: "org_1" },
      { $set: { storageLimitBytes: 100, totalStorageBytes: 0 } },
    );

    const after = await incrementOrgStorage("org_1", 60);
    expect(after.totalStorageBytes).toBe(60);

    await expect(incrementOrgStorage("org_1", 60)).rejects.toThrow();

    const usage = await OrgUsage.findOne({ orgId: "org_1" }).lean();
    expect(usage?.totalStorageBytes).toBe(60); // unchanged after rejection
  });
});
