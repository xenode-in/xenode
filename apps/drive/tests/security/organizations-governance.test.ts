import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as orgGET, DELETE as orgDELETE } from "@/app/api/orgs/[orgId]/route";
import { POST as orgRestorePOST } from "@/app/api/orgs/[orgId]/restore/route";
import { PATCH as ownershipPATCH } from "@/app/api/orgs/[orgId]/ownership/route";
import { PATCH as rolePATCH } from "@/app/api/orgs/[orgId]/members/[memberUserId]/route";
import { DELETE as inviteDELETE } from "@/app/api/orgs/[orgId]/invitations/[invitationId]/route";
import { GET as policyGET, PATCH as policyPATCH } from "@/app/api/orgs/[orgId]/policy/route";
import { POST as joinPOST } from "@/app/api/orgs/[orgId]/join/route";
import { GET as purgeOrgsGET } from "@/app/api/cron/purge-orgs/route";
import { getServerSession } from "@/lib/auth/session";
import { assertNotSoleOwner } from "@/lib/orgs/access";
import { listUserOrgs } from "@/lib/orgs/listUserOrgs";
import Bucket from "@/models/Bucket";
import OrgUsage from "@/models/OrgUsage";
import { createTestProductKey, SpaceProductKey } from "@/tests/helpers/spaceProductKeys";
import { organizationSpaceId } from "@xenode/spaces/ids";
import { ensureOrganizationSpace } from "@xenode/spaces/repository";
import OrgDomain from "@/models/OrgDomain";
import mongoose from "mongoose";

vi.mock("@/lib/razorpay", () => ({
  default: { subscriptions: { cancel: vi.fn(async () => ({})) } },
}));

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "owner_1") {
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

async function createOrg(id = "org_1", extra: Record<string, unknown> = {}) {
  await mongoose.connection.collection("organization").insertOne({
    id,
    name: "Acme",
    slug: id,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
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

function body(method: string, payload?: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/x", {
    method,
    ...(payload === undefined
      ? {}
      : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }),
    ...(headers ? { headers } : {}),
  });
}

const p = (orgId = "org_1") => ({ params: Promise.resolve({ orgId }) });

describe("organization governance", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.CRON_SECRET;
    mockedGetServerSession.mockReset();
  });

  it("transfers ownership: promotes target, demotes actor", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("member_2", "member");

    const res = await ownershipPATCH(
      body("PATCH", { newOwnerUserId: "member_2" }),
      p(),
    );
    expect(res.status).toBe(200);

    const members = mongoose.connection.collection("member");
    const target = await members.findOne({ organizationId: "org_1", userId: "member_2" });
    const actor = await members.findOne({ organizationId: "org_1", userId: "owner_1" });
    expect(target?.role).toBe("owner");
    expect(actor?.role).toBe("admin");
  });

  it("forbids non-owners from transferring ownership", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("admin_1");
    await createOrg();
    await addMember("admin_1", "admin");
    await addMember("member_2", "member");

    const res = await ownershipPATCH(
      body("PATCH", { newOwnerUserId: "member_2" }),
      p(),
    );
    expect(res.status).toBe(403);
  });

  it("soft-deletes an org, hides it, blocks access, then restores it", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");

    const del = await orgDELETE(body("DELETE"), p());
    expect(del.status).toBe(200);

    // Hidden from the workspace switcher list.
    const orgs = await listUserOrgs("owner_1", null);
    expect(orgs).toHaveLength(0);

    // Access blocked (410).
    const blocked = await orgGET(body("GET"), p());
    expect(blocked.status).toBe(410);

    // Owner can restore.
    const restore = await orgRestorePOST(body("POST"), p());
    expect(restore.status).toBe(200);
    const afterRestore = await orgGET(body("GET"), p());
    expect(afterRestore.status).toBe(200);
  });

  it("purges soft-deleted orgs past their window", async () => {
    process.env.CRON_SECRET = "test-secret";
    const past = new Date(Date.now() - 1000);
    await createOrg("org_1", { deletedAt: past, scheduledPurgeAt: past });
    await addMember("owner_1", "owner");
    await OrgUsage.create({ orgId: "org_1", seats: 3 });
    await ensureOrganizationSpace({
      accountId: "owner_1",
      organizationId: "org_1",
    });
    await createTestProductKey({
      spaceId: organizationSpaceId("org_1"),
      memberAccountId: "owner_1",
      wrappedKey: "k",
      keyVersion: 1,
      createdByAccountId: "owner_1",
    });
    await Bucket.findOneAndUpdate(
      { systemKey: "drive" },
      { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
      { upsert: true, new: true },
    );

    const res = await purgeOrgsGET(
      new NextRequest("http://localhost/api/cron/purge-orgs", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.purgedOrgs).toBe(1);

    await expect(
      mongoose.connection.collection("organization").countDocuments({ id: "org_1" }),
    ).resolves.toBe(0);
    await expect(OrgUsage.countDocuments({ orgId: "org_1" })).resolves.toBe(0);
    await expect(SpaceProductKey.countDocuments({ spaceId: organizationSpaceId("org_1") })).resolves.toBe(0);
    await expect(Bucket.countDocuments({ orgId: "org_1" })).resolves.toBe(0);
  });

  it("requires rotation to demote a member to guest", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("member_2", "member");

    const res = await rolePATCH(
      body("PATCH", { role: "guest" }),
      { params: Promise.resolve({ orgId: "org_1", memberUserId: "member_2" }) },
    );
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.code).toBe("space_key_rotation_required");
  });

  it("requires a wrapped key for guest promotion and rejects the removed manager role", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await addMember("guest_2", "guest");
    await addMember("member_3", "member");

    // guest -> member needs a wrapped key.
    const promote = await rolePATCH(
      body("PATCH", { role: "member" }),
      { params: Promise.resolve({ orgId: "org_1", memberUserId: "guest_2" }) },
    );
    expect(promote.status).toBe(400);

    // member -> admin is lateral and does not rotate the product key.
    const lateral = await rolePATCH(
      body("PATCH", { role: "admin" }),
      { params: Promise.resolve({ orgId: "org_1", memberUserId: "member_3" }) },
    );
    expect(lateral.status).toBe(200);
    const m = await mongoose.connection
      .collection("member")
      .findOne({ organizationId: "org_1", userId: "member_3" });
    expect(m?.role).toBe("admin");

    const removedRole = await rolePATCH(
      body("PATCH", { role: "manager" }),
      { params: Promise.resolve({ orgId: "org_1", memberUserId: "member_3" }) },
    );
    expect(removedRole.status).toBe(400);
    await expect(removedRole.json()).resolves.toMatchObject({
      code: "invalid_role",
    });
  });

  it("cancels a pending invitation", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");
    await mongoose.connection.collection("invitation").insertOne({
      id: "inv_1",
      organizationId: "org_1",
      email: "x@example.com",
      role: "member",
      status: "pending",
      inviterId: "owner_1",
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
    });

    const res = await inviteDELETE(body("DELETE"), {
      params: Promise.resolve({ orgId: "org_1", invitationId: "inv_1" }),
    });
    expect(res.status).toBe(200);
    const inv = await mongoose.connection
      .collection("invitation")
      .findOne({ id: "inv_1" });
    expect(inv?.status).toBe("canceled");
  });

  it("reads and updates the org sharing policy", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1");
    await createOrg();
    await addMember("owner_1", "owner");

    const get = await policyGET(body("GET"), p());
    const getBody = await get.json();
    expect(getBody.policy.allowPublicLinks).toBe(true);

    const patch = await policyPATCH(
      body("PATCH", { allowPublicLinks: false, requirePassword: true }),
      p(),
    );
    const patchBody = await patch.json();
    expect(patchBody.policy.allowPublicLinks).toBe(false);
    expect(patchBody.policy.requirePassword).toBe(true);
  });

  it("allows domain guest self-join only for auto policy with verified domain", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("newuser");
    await createOrg("org_1", { domainJoinPolicy: "auto", autoJoinRequiresApproval: false });
    await OrgDomain.create({
      orgId: "org_1",
      domain: "example.com",
      verificationToken: "t",
      status: "verified",
      method: "dns_txt",
      createdBy: "owner_1",
    });

    const res = await joinPOST(body("POST"), p());
    expect(res.status).toBe(201);
    const member = await mongoose.connection
      .collection("member")
      .findOne({ organizationId: "org_1", userId: "newuser" });
    expect(member?.role).toBe("guest");
  });

  it("rejects self-join when the org requires an invitation", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("newuser");
    await createOrg("org_1", { domainJoinPolicy: "suggest" });
    await OrgDomain.create({
      orgId: "org_1",
      domain: "example.com",
      verificationToken: "t",
      status: "verified",
      method: "dns_txt",
      createdBy: "owner_1",
    });

    const res = await joinPOST(body("POST"), p());
    expect(res.status).toBe(403);
  });

  it("blocks account deletion for a sole org owner", async () => {
    await createOrg();
    await addMember("owner_1", "owner");
    await expect(assertNotSoleOwner("owner_1")).rejects.toThrow();

    // A second owner clears the block.
    await addMember("owner_2", "owner");
    await expect(assertNotSoleOwner("owner_1")).resolves.toBeUndefined();
  });
});
