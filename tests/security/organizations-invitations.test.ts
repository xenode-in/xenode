import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET as orgInvitationsGET,
  POST as orgInvitationsPOST,
} from "@/app/api/orgs/[orgId]/invitations/route";
import { GET as myInvitationsGET } from "@/app/api/orgs/invitations/route";
import { POST as invitationActionPOST } from "@/app/api/orgs/invitations/[invitationId]/route";
import { PATCH as invitationGrantPATCH } from "@/app/api/orgs/[orgId]/invitations/[invitationId]/route";
import { POST as invitationClaimPOST } from "@/app/api/orgs/invitations/[invitationId]/claim/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import OrgKeyGrant from "@/models/OrgKeyGrant";
import OrgMembershipHistory from "@/models/OrgMembershipHistory";
import UserKeyVault from "@/models/UserKeyVault";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId = "user_1", email = `${userId}@example.com`) {
  mockedGetServerSession.mockResolvedValue({
    user: {
      id: userId,
      email,
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
      activeOrganizationId: "org_1",
    },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function createOrg() {
  await Bucket.db.collection("organization").insertOne({
    id: "org_1",
    name: "Acme",
    slug: "acme",
    logo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function addMember(userId: string, role = "member") {
  await Bucket.db.collection("member").insertOne({
    id: `mem_${userId}`,
    userId,
    organizationId: "org_1",
    role,
    createdAt: new Date(),
  });
}

async function addUser(userId: string, email = `${userId}@example.com`) {
  await Bucket.db.collection("user").insertOne({
    id: userId,
    email,
    name: `User ${userId}`,
    image: null,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function addInvitation(args: {
  id?: string;
  email?: string;
  role?: string;
  status?: string;
  recipientUserId?: string | null;
  wrappedSpaceKey?: string | null;
  keyVersion?: number | null;
  expiresAt?: Date;
}) {
  await Bucket.db.collection("invitation").insertOne({
    id: args.id ?? "inv_1",
    organizationId: "org_1",
    email: args.email ?? "invitee@example.com",
    role: args.role ?? "member",
    status: args.status ?? "pending",
    inviterId: "owner_1",
    recipientUserId: args.recipientUserId ?? null,
    wrappedSpaceKey: args.wrappedSpaceKey ?? null,
    keyVersion: args.keyVersion ?? null,
    expiresAt: args.expiresAt ?? new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function orgParams(orgId = "org_1") {
  return { params: Promise.resolve({ orgId }) };
}

function invitationParams(invitationId = "inv_1") {
  return { params: Promise.resolve({ invitationId }) };
}

function orgInvitationParams(orgId = "org_1", invitationId = "inv_1") {
  return { params: Promise.resolve({ orgId, invitationId }) };
}

function patchGrant(body: unknown) {
  return new NextRequest(
    "http://localhost/api/orgs/org_1/invitations/inv_1",
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

function postClaim() {
  return new NextRequest(
    "http://localhost/api/orgs/invitations/inv_1/claim",
    { method: "POST" },
  );
}

async function addVault(userId: string, publicKey = `pub-${userId}`) {
  await UserKeyVault.create({
    userId,
    publicKey,
    encryptedPrivateKey: "x",
    pbkdf2Salt: "x",
    iv: "x",
    encryptedRecoveryWords: "x",
    recoveryIv: "x",
    recoverySalt: "x",
  });
}

function postOrgInvite(body: unknown) {
  return new NextRequest("http://localhost/api/orgs/org_1/invitations", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function postInvitationAction(body: unknown) {
  return new NextRequest("http://localhost/api/orgs/invitations/inv_1", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("organization invitations", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("hides invitations while organizations are disabled", async () => {
    mockSession("owner_1");

    const response = await myInvitationsGET(
      new NextRequest("http://localhost/api/orgs/invitations"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Organizations are not enabled",
      code: "organizations_not_enabled",
    });
  });

  it("lets owners invite existing users with a pending wrapped space key", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await createOrg();
    await addMember("owner_1", "owner");
    await addUser("user_1", "invitee@example.com");

    const response = await orgInvitationsPOST(
      postOrgInvite({
        email: "INVITEE@example.com",
        role: "member",
        wrappedSpaceKey: "wrapped-for-invitee",
        keyVersion: 2,
      }),
      orgParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.invitation.email).toBe("invitee@example.com");
    expect(body.invitation.recipientUserId).toBe("user_1");
    expect(body.invitation.spaceKeyReady).toBe(true);
    expect(await Bucket.db.collection("invitation").countDocuments()).toBe(1);
  });

  it("rejects duplicate pending invitations", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await createOrg();
    await addMember("owner_1", "admin");
    await addUser("user_1", "invitee@example.com");
    await addInvitation({
      email: "invitee@example.com",
      recipientUserId: "user_1",
      wrappedSpaceKey: "pending",
      keyVersion: 1,
    });

    const response = await orgInvitationsPOST(
      postOrgInvite({
        email: "invitee@example.com",
        role: "member",
        wrappedSpaceKey: "wrapped-again",
        keyVersion: 2,
      }),
      orgParams(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A pending invitation already exists for this email",
    });
  });

  it("lets managers and admins list organization invitations", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("manager_1", "manager@example.com");
    await createOrg();
    await addMember("manager_1", "manager");
    await addInvitation({
      id: "inv_1",
      email: "invitee@example.com",
      recipientUserId: "user_1",
      wrappedSpaceKey: "wrapped",
      keyVersion: 1,
    });
    await addInvitation({
      id: "inv_2",
      email: "guest@example.com",
      role: "guest",
    });

    const response = await orgInvitationsGET(
      new NextRequest("http://localhost/api/orgs/org_1/invitations"),
      orgParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invitations).toHaveLength(2);
    expect(body.invitations.map((invite: { id: string }) => invite.id).sort()).toEqual([
      "inv_1",
      "inv_2",
    ]);
  });

  it("does not let regular members create invitations", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("member_1", "member@example.com");
    await createOrg();
    await addMember("member_1", "member");
    await addUser("user_1", "invitee@example.com");

    const response = await orgInvitationsPOST(
      postOrgInvite({
        email: "invitee@example.com",
        role: "member",
        wrappedSpaceKey: "wrapped",
        keyVersion: 1,
      }),
      orgParams(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_admin_required",
    });
  });

  it("lists pending invitations for the signed-in email only", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1", "invitee@example.com");
    await createOrg();
    await addInvitation({
      id: "inv_1",
      email: "invitee@example.com",
      recipientUserId: "user_1",
      wrappedSpaceKey: "wrapped",
      keyVersion: 1,
    });
    await addInvitation({
      id: "inv_2",
      email: "other@example.com",
      recipientUserId: "user_2",
      wrappedSpaceKey: "wrapped",
      keyVersion: 1,
    });

    const response = await myInvitationsGET(
      new NextRequest("http://localhost/api/orgs/invitations"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invitations).toHaveLength(1);
    expect(body.invitations[0].id).toBe("inv_1");
    expect(body.invitations[0].organization.name).toBe("Acme");
  });

  it("accepts an invitation and moves the pending key into org key grants", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1", "invitee@example.com");
    await createOrg();
    await addInvitation({
      email: "invitee@example.com",
      recipientUserId: "user_1",
      wrappedSpaceKey: "wrapped-for-invitee",
      keyVersion: 3,
    });

    const response = await invitationActionPOST(
      postInvitationAction({ action: "accept" }),
      invitationParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.memberCreated).toBe(true);
    expect(body.spaceKeyReady).toBe(true);
    expect(await Bucket.db.collection("member").countDocuments({
      organizationId: "org_1",
      userId: "user_1",
      role: "member",
    })).toBe(1);
    expect(await OrgKeyGrant.countDocuments({
      orgId: "org_1",
      memberUserId: "user_1",
      wrappedSpaceKey: "wrapped-for-invitee",
      keyVersion: 3,
    })).toBe(1);
  });

  it("fails closed before membership when an encrypted invite lacks a key", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1", "invitee@example.com");
    await createOrg();
    await addInvitation({
      email: "invitee@example.com",
      recipientUserId: "user_1",
      wrappedSpaceKey: null,
      keyVersion: null,
    });

    const response = await invitationActionPOST(
      postInvitationAction({ action: "accept" }),
      invitationParams(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Encrypted organization access requires a wrapped space key",
      code: "space_key_grant_required",
    });
    expect(await Bucket.db.collection("member").countDocuments()).toBe(0);
  });

  it("lets guests accept without a storage key grant", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("guest_1", "guest@example.com");
    await createOrg();
    await addInvitation({
      email: "guest@example.com",
      role: "guest",
      recipientUserId: null,
      wrappedSpaceKey: null,
      keyVersion: null,
    });

    const response = await invitationActionPOST(
      postInvitationAction({ action: "accept" }),
      invitationParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.memberCreated).toBe(true);
    expect(body.spaceKeyReady).toBe(false);
    expect(await Bucket.db.collection("member").countDocuments({
      organizationId: "org_1",
      userId: "guest_1",
      role: "guest",
    })).toBe(1);
    expect(await OrgKeyGrant.countDocuments()).toBe(0);
  });

  it("lets invitees reject pending invitations", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1", "invitee@example.com");
    await createOrg();
    await addInvitation({
      email: "invitee@example.com",
      recipientUserId: "user_1",
      wrappedSpaceKey: "wrapped",
      keyVersion: 1,
    });

    const response = await invitationActionPOST(
      postInvitationAction({ action: "reject" }),
      invitationParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invitation.status).toBe("rejected");
    expect(await Bucket.db.collection("member").countDocuments()).toBe(0);
  });

  it("creates a deferred invitation for an email with no account", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await createOrg();
    await addMember("owner_1", "owner");
    // No user exists for newhire@example.com.

    const response = await orgInvitationsPOST(
      postOrgInvite({ email: "newhire@example.com", role: "member" }),
      orgParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.invitation.recipientUserId).toBeNull();
    expect(body.invitation.spaceKeyReady).toBe(false);
    expect(body.invitation.awaitingRecipientKey).toBe(true);
    expect(body.invitation.previouslyMember).toBe(false);
  });

  it("flags a re-invite of a previously removed email", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await createOrg();
    await addMember("owner_1", "owner");
    await OrgMembershipHistory.create({
      orgId: "org_1",
      userId: "old_1",
      email: "reused@example.com",
      role: "member",
      removedAt: new Date("2026-01-01T00:00:00Z"),
      removedBy: "owner_1",
      reason: "removed",
    });

    const response = await orgInvitationsPOST(
      postOrgInvite({ email: "reused@example.com", role: "guest" }),
      orgParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.invitation.previouslyMember).toBe(true);
    expect(body.invitation.lastRemovedAt).toBeTruthy();
  });

  it("grants the deferred space key to a ready invitee", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await createOrg();
    await addMember("owner_1", "owner");
    await OrgKeyGrant.create({
      orgId: "org_1",
      teamId: null,
      memberUserId: "owner_1",
      wrappedSpaceKey: "owner-key",
      keyVersion: 1,
      wrappedByUserId: "owner_1",
      createdBy: "owner_1",
      rotationReason: "initial",
    });
    await addInvitation({
      email: "newhire@example.com",
      role: "member",
      recipientUserId: "nh_1",
      wrappedSpaceKey: null,
      keyVersion: null,
    });

    const response = await invitationGrantPATCH(
      patchGrant({ wrappedSpaceKey: "wrapped-for-nh", keyVersion: 1 }),
      orgInvitationParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.spaceKeyReady).toBe(true);
    const invitation = await Bucket.db
      .collection("invitation")
      .findOne({ id: "inv_1" });
    expect(invitation?.wrappedSpaceKey).toBe("wrapped-for-nh");
    expect(invitation?.keyVersion).toBe(1);
  });

  it("rejects granting a stale key version", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await createOrg();
    await addMember("owner_1", "owner");
    await OrgKeyGrant.create({
      orgId: "org_1",
      teamId: null,
      memberUserId: "owner_1",
      wrappedSpaceKey: "owner-key",
      keyVersion: 2,
      wrappedByUserId: "owner_1",
      createdBy: "owner_1",
      rotationReason: "initial",
    });
    await addInvitation({
      email: "newhire@example.com",
      role: "member",
      recipientUserId: "nh_1",
    });

    const response = await invitationGrantPATCH(
      patchGrant({ wrappedSpaceKey: "wrapped", keyVersion: 1 }),
      orgInvitationParams(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "stale_key_version",
    });
  });

  it("marks the invitee ready on claim when their vault exists", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("nh_1", "newhire@example.com");
    await createOrg();
    await addMember("owner_1", "owner");
    await addVault("nh_1");
    await addInvitation({
      email: "newhire@example.com",
      role: "member",
      recipientUserId: null,
      wrappedSpaceKey: null,
      keyVersion: null,
    });

    const response = await invitationClaimPOST(postClaim(), invitationParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.awaitingGrant).toBe(true);
    const invitation = await Bucket.db
      .collection("invitation")
      .findOne({ id: "inv_1" });
    expect(invitation?.recipientUserId).toBe("nh_1");
    expect(invitation?.recipientReadyAt).toBeTruthy();
  });

  it("reports needsVault on claim when the invitee has no vault", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("nh_1", "newhire@example.com");
    await createOrg();
    await addInvitation({
      email: "newhire@example.com",
      role: "member",
      recipientUserId: null,
      wrappedSpaceKey: null,
      keyVersion: null,
    });

    const response = await invitationClaimPOST(postClaim(), invitationParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.needsVault).toBe(true);
    const invitation = await Bucket.db
      .collection("invitation")
      .findOne({ id: "inv_1" });
    expect(invitation?.recipientReadyAt ?? null).toBeNull();
  });

  it("rejects a claim from a mismatched email", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("intruder_1", "intruder@example.com");
    await createOrg();
    await addInvitation({
      email: "newhire@example.com",
      role: "member",
      recipientUserId: null,
    });

    const response = await invitationClaimPOST(postClaim(), invitationParams());

    expect(response.status).toBe(403);
  });
});
