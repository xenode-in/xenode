import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductSession, UserVault } from "@xenode/database";
import { POST as activePOST } from "@/app/api/orgs/active/route";
import { POST as recipientsPOST } from "@/app/api/orgs/recipients/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";

function testEnvelope(type: "password" | "recovery" | "sharing-private-key") {
  return {
    formatVersion: 2,
    algorithm: "AES-256-GCM",
    keyId: type === "sharing-private-key" ? type : "ark",
    keyVersion: 1,
    ciphertext: "ciphertext-for-test",
    iv: "test-initial-vector",
    aadVersion: 1,
    createdAt: new Date(),
    status: "active",
  };
}

const mockedGetServerSession = vi.mocked(getServerSession);
type MockSession = NonNullable<Awaited<ReturnType<typeof getServerSession>>>;

function mockSession(userId = "user_1", email = `${userId}@example.com`) {
  const session = {
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
      activeOrganizationId: null,
    },
  } as unknown as MockSession;
  mockedGetServerSession.mockResolvedValue(session);
  return session;
}

/**
 * Post OIDC cutover the active-org pointer lives on the caller's Drive
 * ProductSession, so tests seed that document instead of the removed
 * better-auth `session` collection.
 */
async function insertSessionDocument(
  session: MockSession,
  fields: { activeOrganizationId?: string | null } = {},
) {
  await ProductSession.create({
    sessionId: session.session.id,
    accountId: session.session.userId,
    productId: "drive",
    issuerSessionId: "accounts-session-1",
    clientId: "xenode-drive-web",
    authenticatedAt: session.session.createdAt,
    sessionVersion: 1,
    expiresAt: session.session.expiresAt,
    activeOrganizationId: fields.activeOrganizationId ?? null,
  });
}

async function findProductSession(session: MockSession) {
  return ProductSession.findOne({ sessionId: session.session.id }).lean();
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

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("organization UI support APIs", () => {
  afterEach(() => {
    delete process.env.ORGS_ENABLED;
    delete process.env.NEXT_PUBLIC_ORGS_ENABLED;
    mockedGetServerSession.mockReset();
  });

  it("looks up invite recipients by auth user id and vault public key", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("owner_1", "owner@example.com");
    await addUser("owner_1", "owner@example.com");
    await addUser("user_1", "invitee@example.com");
    await addUser("user_2", "novault@example.com");
    await UserVault.create({
      accountId: "user_1",
      vaultRevision: 1,
      passwordEnvelope: testEnvelope("password"),
      recoveryEnvelope: testEnvelope("recovery"),
      deviceEnvelopes: [],
      sharingPublicKey: "recipient-public-key",
      wrappedSharingPrivateKey: testEnvelope("sharing-private-key"),
      formatVersion: 2,
    });

    const response = await recipientsPOST(
      post("/api/orgs/recipients", {
        emails: ["invitee@example.com", "novault@example.com", "owner@example.com"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recipients).toEqual([
      {
        userId: "user_1",
        email: "invitee@example.com",
        name: "User user_1",
        publicKey: "recipient-public-key",
      },
    ]);
    expect(body.unavailable).toEqual([
      {
        email: "novault@example.com",
        reason: "Recipient has not set up their encryption vault yet",
      },
      {
        email: "owner@example.com",
        reason: "You cannot invite your own account",
      },
    ]);
  });

  it("switches the active organization only for members", async () => {
    process.env.ORGS_ENABLED = "true";
    const session = mockSession("user_1");
    await insertSessionDocument(session);
    await createOrg();
    await addMember("user_1", "member");

    const response = await activePOST(
      post("/api/orgs/active", { orgId: "org_1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      activeOrganizationId: "org_1",
      scope: "organization",
    });
    await expect(findProductSession(session)).resolves.toMatchObject({
      activeOrganizationId: "org_1",
    });
  });

  it("clears active organization when switching back to personal scope", async () => {
    process.env.ORGS_ENABLED = "true";
    const session = mockSession("user_1");
    await insertSessionDocument(session, {
      activeOrganizationId: "org_1",
    });

    const response = await activePOST(
      post("/api/orgs/active", { orgId: null }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ activeOrganizationId: null, scope: "personal" });
    await expect(findProductSession(session)).resolves.toMatchObject({
      activeOrganizationId: null,
    });
  });

  it("reports an error when no live product session can persist the switch", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    // No ProductSession document seeded — persistence must fail closed.
    await createOrg();
    await addMember("user_1", "member");

    const response = await activePOST(
      post("/api/orgs/active", { orgId: "org_1" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to persist active organization",
      code: "active_organization_not_persisted",
    });
  });

  it("does not switch active organization for non-members", async () => {
    process.env.ORGS_ENABLED = "true";
    const session = mockSession("user_1");
    await insertSessionDocument(session);
    await createOrg();

    const response = await activePOST(
      post("/api/orgs/active", { orgId: "org_1" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_membership_required",
    });
    await expect(findProductSession(session)).resolves.toMatchObject({
      activeOrganizationId: null,
    });
  });
});
