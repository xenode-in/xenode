import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { AccountProfile, ProductSession, UserVault, getDatabase } from "@xenode/database";
import { generateAccountRootKey, sealEnvelope } from "@xenode/crypto-core";
import { User } from "@/models/User";

// The global setup mocks @/lib/auth/session for route tests; this suite
// exercises the REAL resolution path introduced by the OIDC cutover.
vi.unmock("@/lib/auth/session");

import {
  DRIVE_SESSION_COOKIE,
  getServerSession,
  requireAuth,
} from "@/lib/auth/session";
import { createDriveSessionCookie } from "@/lib/auth/product-cookie";

async function seedAccount() {
  const user = await User.create({
    name: "Res Olver",
    email: `resolver-${Date.now()}@example.com`,
    emailVerified: true,
    authVerifier: "server-secret-verifier",
    twoFactorSecret: "server-secret-totp",
  });
  const accountId = String(user._id);
  const wrappingKey = generateAccountRootKey();
  const ark = generateAccountRootKey();
  try {
    const envelope = (type: "password" | "recovery" | "sharing-private-key") =>
      sealEnvelope(ark, wrappingKey, { accountId, keyId: "ark", keyVersion: 1, type });
    await AccountProfile.create({ accountId, onboarded: true });
    await UserVault.create({
      accountId, vaultRevision: 1, formatVersion: 2,
      passwordEnvelope: await envelope("password"),
      recoveryEnvelope: await envelope("recovery"),
      wrappedSharingPrivateKey: await envelope("sharing-private-key"),
      sharingPublicKey: "synthetic-session-fixture-not-a-sharing-key",
    });
    await getDatabase().collection("account").insertOne({
      userId: user._id, providerId: "credential", password: "synthetic-credential-hash",
    });
  } finally {
    wrappingKey.fill(0);
    ark.fill(0);
  }
  return accountId;
}

async function seedSession(accountId: string, sessionId: string) {
  await ProductSession.create({
    sessionId,
    accountId,
    productId: "drive",
    issuerSessionId: "accounts-session-1",
    clientId: "xenode-drive-web",
    authenticatedAt: new Date(),
    sessionVersion: 1,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function sessionCredential(sessionId: string) {
  return createDriveSessionCookie({
    sessionId,
    sessionVersion: 1,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function requestWithCookie(sessionId: string) {
  return new NextRequest("http://localhost/api/objects", {
    headers: {
      cookie: `${DRIVE_SESSION_COOKIE}=${await sessionCredential(sessionId)}`,
    },
  });
}

describe("Drive session resolution (real implementation)", () => {
  it.each(["profile", "vault", "password-envelope", "credential"])(
    "rejects an authenticated account missing onboarding %s",
    async (missing) => {
      const accountId = await seedAccount();
      await seedSession(accountId, "resolution-incomplete");
      if (missing === "profile") await AccountProfile.deleteOne({ accountId });
      if (missing === "vault") await UserVault.deleteOne({ accountId });
      if (missing === "password-envelope") await UserVault.updateOne({ accountId }, { $set: { passwordEnvelope: null } });
      if (missing === "credential") await getDatabase().collection("account").deleteMany({});
      await expect(getServerSession(await requestWithCookie("resolution-incomplete"))).resolves.toBeNull();
    },
  );
  it("hydrates the product session shape from ProductSession + user doc", async () => {
    const accountId = await seedAccount();
    await seedSession(accountId, "resolution-live");

    const session = await getServerSession(
      await requestWithCookie("resolution-live"),
    );
    expect(session).not.toBeNull();
    expect(session!.user.id).toBe(accountId);
    expect(session!.user.name).toBe("Res Olver");
    expect(session!.session).toMatchObject({
      id: "resolution-live",
      userId: accountId,
      productId: "drive",
      sessionVersion: 1,
      activeOrganizationId: null,
    });
    // Sensitive credential material never crosses the session boundary.
    expect(session!.user.authVerifier).toBeUndefined();
    expect(session!.user.twoFactorSecret).toBeUndefined();
  });

  it("accepts Authorization: Bearer for non-browser clients", async () => {
    const accountId = await seedAccount();
    await seedSession(accountId, "resolution-bearer");

    const request = new NextRequest("http://localhost/api/objects", {
      headers: {
        authorization: `Bearer ${await sessionCredential("resolution-bearer")}`,
      },
    });
    const session = await getServerSession(request);
    expect(session?.user.id).toBe(accountId);
  });

  it("never resolves revoked sessions and requireAuth fails closed", async () => {
    const accountId = await seedAccount();
    await seedSession(accountId, "resolution-revoked");
    await ProductSession.updateOne(
      { sessionId: "resolution-revoked" },
      { $set: { revokedAt: new Date() } },
    );

    await expect(
      getServerSession(await requestWithCookie("resolution-revoked")),
    ).resolves.toBeNull();
    await expect(
      requireAuth(await requestWithCookie("resolution-revoked")),
    ).rejects.toThrow("Unauthorized");
    await expect(
      requireAuth(new NextRequest("http://localhost/api/objects")),
    ).rejects.toThrow("Unauthorized");
  });
});
