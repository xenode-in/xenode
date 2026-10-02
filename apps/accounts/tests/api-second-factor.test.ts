import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccountsSession: vi.fn(),
  applyTrustedSecondFactor: vi.fn(),
  getAccountsAuth: vi.fn(),
  nativePost: vi.fn(),
  revokeIssuerProductsBeforeSessionDelete: vi.fn(),
}));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ POST: mocks.nativePost }),
}));
vi.mock("@/lib/session", () => ({
  getAccountsSession: mocks.getAccountsSession,
  needsSecondFactor: (value: {
    user: { twoFactorEnabled?: boolean };
    session: { authMethod?: string; twoFactorVerifiedAt?: Date };
  }) =>
    value.user.twoFactorEnabled === true &&
    value.session.authMethod === "oauth" &&
    !value.session.twoFactorVerifiedAt,
}));
vi.mock("@/lib/trusted-second-factor", () => ({
  applyTrustedSecondFactor: mocks.applyTrustedSecondFactor,
}));
vi.mock("@/lib/auth", () => ({ getAccountsAuth: mocks.getAccountsAuth }));
vi.mock("@/lib/issuer-session-revocation", () => ({
  revokeIssuerProductsBeforeSessionDelete:
    mocks.revokeIssuerProductsBeforeSessionDelete,
}));

import {
  authorizeAccountsApiRequest,
  authorizeNativeAuthPost,
} from "../lib/api-session";
import { DELETE as deleteDevice } from "../app/api/account/devices/route";
import { POST as nativeAuthPost } from "../app/api/auth/[...all]/route";
import { VAULT_CLIENT_HEADERS } from "../lib/vault-protocol";
import {
  GET as getAccountPasskeys,
  POST as postAccountPasskeys,
  DELETE as deleteAccountPasskeys,
} from "../app/api/account/passkeys/route";
import { POST as setPassword } from "../app/api/account/password/route";
import { POST as changePassword } from "../app/api/account/password/change/route";
import { POST as signOutEverywhere } from "../app/api/account/sign-out-everywhere/route";
import { DELETE as deleteTrustedFactor } from "../app/api/account/two-factor/trusted/route";
import { POST as createHandoff } from "../app/api/key-handoffs/route";
import { POST as completeOnboarding } from "../app/api/onboarding/complete/route";
import {
  GET as getProductSessions,
  DELETE as deleteProductSession,
} from "../app/api/product-sessions/route";
import { GET as getProfile, PUT as putProfile } from "../app/api/profile/route";
import { GET as getSpaceKey } from "../app/api/space-product-keys/route";
import { GET as getVault } from "../app/api/vault/route";
import { POST as bootstrapVault } from "../app/api/vault/bootstrap/route";
import {
  POST as postVaultDevice,
  DELETE as deleteVaultDevice,
} from "../app/api/vault/devices/route";
import {
  GET as getVaultPasskeys,
  DELETE as deleteVaultPasskey,
} from "../app/api/vault/passkeys/route";
import { POST as registerVaultPasskeyOptions } from "../app/api/vault/passkeys/register/options/route";
import { POST as registerVaultPasskeyVerify } from "../app/api/vault/passkeys/register/verify/route";
import { POST as unlockVaultPasskeyOptions } from "../app/api/vault/passkeys/unlock/options/route";
import { POST as unlockVaultPasskeyVerify } from "../app/api/vault/passkeys/unlock/verify/route";
import { POST as postVaultPasswordEnvelope } from "../app/api/vault/password-envelope/route";
import { PUT as separateVaultPassword } from "../app/api/vault/separate-password/route";
import { POST as confirmVaultUnlock } from "../app/api/vault/unlock/route";

const origin = "https://accounts.xenode.in";
const pendingSession = {
  user: { id: "account-1", twoFactorEnabled: true },
  session: { id: "session-1", authMethod: "oauth", twoFactorVerifiedAt: null },
};

function request(path: string, method: string, suppliedOrigin = origin) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin: suppliedOrigin,
      ...VAULT_CLIENT_HEADERS,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAccountsSession.mockResolvedValue(pendingSession);
  mocks.applyTrustedSecondFactor.mockResolvedValue(false);
});

describe("Accounts API session step-up", () => {
  it.each([
    ["DELETE device", deleteDevice, "/api/account/devices", "DELETE"],
    ["GET account passkeys", getAccountPasskeys, "/api/account/passkeys", "GET"],
    ["POST account passkeys", postAccountPasskeys, "/api/account/passkeys", "POST"],
    ["DELETE account passkeys", deleteAccountPasskeys, "/api/account/passkeys", "DELETE"],
    ["set sign-in password", setPassword, "/api/account/password", "POST"],
    ["change sign-in password", changePassword, "/api/account/password/change", "POST"],
    ["sign out everywhere", signOutEverywhere, "/api/account/sign-out-everywhere", "POST"],
    ["DELETE trusted second factor", deleteTrustedFactor, "/api/account/two-factor/trusted", "DELETE"],
    ["create key handoff", createHandoff, "/api/key-handoffs", "POST"],
    ["complete onboarding", completeOnboarding, "/api/onboarding/complete", "POST"],
    ["GET product sessions", getProductSessions, "/api/product-sessions", "GET"],
    ["DELETE product session", deleteProductSession, "/api/product-sessions", "DELETE"],
    ["GET profile", getProfile, "/api/profile", "GET"],
    ["PUT profile", putProfile, "/api/profile", "PUT"],
    ["GET space key", getSpaceKey, "/api/space-product-keys", "GET"],
    ["GET Vault", getVault, "/api/vault", "GET"],
    ["bootstrap Vault", bootstrapVault, "/api/vault/bootstrap", "POST"],
    ["POST Vault device", postVaultDevice, "/api/vault/devices", "POST"],
    ["DELETE Vault device", deleteVaultDevice, "/api/vault/devices", "DELETE"],
    ["GET Vault passkeys", getVaultPasskeys, "/api/vault/passkeys", "GET"],
    ["DELETE Vault passkey", deleteVaultPasskey, "/api/vault/passkeys", "DELETE"],
    ["register Vault passkey options", registerVaultPasskeyOptions, "/api/vault/passkeys/register/options", "POST"],
    ["register Vault passkey verification", registerVaultPasskeyVerify, "/api/vault/passkeys/register/verify", "POST"],
    ["unlock Vault passkey options", unlockVaultPasskeyOptions, "/api/vault/passkeys/unlock/options", "POST"],
    ["unlock Vault passkey verification", unlockVaultPasskeyVerify, "/api/vault/passkeys/unlock/verify", "POST"],
    ["POST Vault password envelope", postVaultPasswordEnvelope, "/api/vault/password-envelope", "POST"],
    ["separate Vault password", separateVaultPassword, "/api/vault/separate-password", "PUT"],
    ["confirm Vault unlock", confirmVaultUnlock, "/api/vault/unlock", "POST"],
  ] as const)("rejects pending OAuth session at %s", async (_name, handler, path, method) => {
    const response = await handler(request(path, method));
    expect(response.status).toBe(403);
    expect(mocks.getAccountsAuth).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutations before using a session", async () => {
    const response = await authorizeAccountsApiRequest(
      request("/api/profile", "PUT", "https://attacker.test"),
    );
    expect(response?.status).toBe(403);
    expect(mocks.getAccountsSession).not.toHaveBeenCalled();
  });

  it("accepts verified sessions and a valid trusted-device continuation", async () => {
    mocks.getAccountsSession.mockResolvedValueOnce({
      ...pendingSession,
      session: { ...pendingSession.session, twoFactorVerifiedAt: new Date() },
    });
    expect(await authorizeAccountsApiRequest(request("/api/profile", "PUT"))).toBeNull();
    mocks.applyTrustedSecondFactor.mockResolvedValueOnce(true);
    expect(await authorizeAccountsApiRequest(request("/api/vault", "GET"))).toBeNull();
  });

  it("blocks native account mutations but permits verification and sign-out", async () => {
    expect((await authorizeNativeAuthPost(request("/api/auth/oauth2/consent", "POST")))?.status).toBe(403);
    expect((await authorizeNativeAuthPost(request("/api/auth/link-social", "POST")))?.status).toBe(403);
    expect((await authorizeNativeAuthPost(request("/api/auth/passkey/add-passkey", "POST")))?.status).toBe(403);
    for (const path of [
      "/api/auth/two-factor/verify-totp",
      "/api/auth/two-factor/verify-backup-code",
      "/api/auth/sign-out",
      "/api/auth/sign-in/email",
      "/api/auth/oauth2/token",
    ]) {
      expect(await authorizeNativeAuthPost(request(path, "POST"))).toBeNull();
    }
  });

  it("does not apply trusted second factor from a foreign origin", async () => {
    const response = await authorizeNativeAuthPost(
      request("/api/auth/link-social", "POST", "https://attacker.test"),
    );
    expect(response?.status).toBe(403);
    expect(mocks.applyTrustedSecondFactor).not.toHaveBeenCalled();
  });

  it("enforces the native auth gate at the route boundary", async () => {
    const blocked = await nativeAuthPost(request("/api/auth/oauth2/consent", "POST"));
    expect(blocked.status).toBe(403);
    expect(mocks.nativePost).not.toHaveBeenCalled();

    mocks.nativePost.mockResolvedValueOnce(Response.json({ ok: true }));
    mocks.getAccountsAuth.mockResolvedValueOnce({
      api: { getSession: vi.fn().mockResolvedValue(null) },
    });
    const allowed = await nativeAuthPost(request("/api/auth/sign-out", "POST"));
    expect(allowed.status).toBe(200);
    expect(mocks.nativePost).toHaveBeenCalledOnce();
  });

  it("revokes issuer products before native sign-out can clear its cookie", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: { id: "account-1" },
      session: { id: "session-1", userId: "account-1" },
    });
    mocks.getAccountsAuth.mockResolvedValueOnce({ api: { getSession } });
    mocks.nativePost.mockResolvedValueOnce(Response.json({ success: true }));
    const response = await nativeAuthPost(request("/api/auth/sign-out", "POST"));
    expect(response.status).toBe(200);
    expect(getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true },
    });
    expect(mocks.revokeIssuerProductsBeforeSessionDelete).toHaveBeenCalledWith({
      id: "session-1",
      userId: "account-1",
    });
    expect(mocks.nativePost).toHaveBeenCalledOnce();
    expect(
      mocks.revokeIssuerProductsBeforeSessionDelete.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.nativePost.mock.invocationCallOrder[0]);
  });

  it("rejects foreign-origin native sign-out before resolving its session", async () => {
    const response = await nativeAuthPost(
      request("/api/auth/sign-out", "POST", "https://attacker.test"),
    );
    expect(response.status).toBe(403);
    expect(mocks.getAccountsAuth).not.toHaveBeenCalled();
    expect(mocks.nativePost).not.toHaveBeenCalled();
  });

  it("does not call native sign-out when product revocation fails", async () => {
    mocks.getAccountsAuth.mockResolvedValueOnce({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: { id: "session-1", userId: "account-1" },
          user: { id: "account-1" },
        }),
      },
    });
    mocks.revokeIssuerProductsBeforeSessionDelete.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(nativeAuthPost(request("/api/auth/sign-out", "POST"))).rejects.toThrow(
      "storage unavailable",
    );
    expect(mocks.nativePost).not.toHaveBeenCalled();
  });
});
