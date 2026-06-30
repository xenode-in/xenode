import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as activePOST } from "@/app/api/orgs/active/route";
import { POST as recipientsPOST } from "@/app/api/orgs/recipients/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
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
      activeOrganizationId: null,
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

async function addSession(userId: string) {
  await Bucket.db.collection("session").insertOne({
    id: `session-${userId}`,
    userId,
    token: `token-${userId}`,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
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
    await UserKeyVault.create({
      userId: "user_1",
      publicKey: "recipient-public-key",
      encryptedPrivateKey: "encrypted",
      pbkdf2Salt: "salt",
      iv: "iv",
      encryptedRecoveryWords: "words",
      recoveryIv: "recovery-iv",
      recoverySalt: "recovery-salt",
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
    mockSession("user_1");
    await createOrg();
    await addMember("user_1", "member");
    await addSession("user_1");

    const response = await activePOST(
      post("/api/orgs/active", { orgId: "org_1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      activeOrganizationId: "org_1",
      scope: "organization",
    });
    expect(
      await Bucket.db.collection("session").findOne({ id: "session-user_1" }),
    ).toMatchObject({ activeOrganizationId: "org_1" });
  });

  it("clears active organization when switching back to personal scope", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await addSession("user_1");
    await Bucket.db.collection("session").updateOne(
      { id: "session-user_1" },
      { $set: { activeOrganizationId: "org_1", activeTeamId: "team_1" } },
    );

    const response = await activePOST(
      post("/api/orgs/active", { orgId: null }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ activeOrganizationId: null, scope: "personal" });
    const session = await Bucket.db
      .collection("session")
      .findOne({ id: "session-user_1" });
    expect(session?.activeOrganizationId).toBeUndefined();
    expect(session?.activeTeamId).toBeUndefined();
  });

  it("does not switch active organization for non-members", async () => {
    process.env.ORGS_ENABLED = "true";
    mockSession("user_1");
    await createOrg();
    await addSession("user_1");

    const response = await activePOST(
      post("/api/orgs/active", { orgId: "org_1" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "organization_membership_required",
    });
    const session = await Bucket.db
      .collection("session")
      .findOne({ id: "session-user_1" });
    expect(session?.activeOrganizationId).toBeUndefined();
  });
});
