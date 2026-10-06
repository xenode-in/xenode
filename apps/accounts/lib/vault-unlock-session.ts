import { getServerProductOrigin } from "@xenode/config";
import { jwtVerify, SignJWT } from "jose";

export const VAULT_UNLOCK_COOKIE = "xenode_vault_unlocked";
export const VAULT_UNLOCK_TTL_SECONDS = 30 * 60;

// Invalidate the old password-verification marker after secret separation.
// This is a navigation hint, never proof of key possession or API authorization.
const PURPOSE = "vault-local-unlock-v2";
const AUDIENCE = "xenode-accounts";

function accountsOrigin() {
  return new URL(
    getServerProductOrigin("accounts"),
  ).origin;
}

function signingKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

function cookieValue(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null;
    }
  }
  return null;
}

/** Attributes of the unlock-confirmation cookie (shared by every writer). */
export function vaultUnlockCookieAttributes() {
  return {
    httpOnly: true,
    secure: accountsOrigin().startsWith("https://"),
    sameSite: "strict" as const,
    path: "/",
    maxAge: VAULT_UNLOCK_TTL_SECONDS,
  };
}

export async function createVaultUnlockToken(params: {
  accountId: string;
  sessionId: string;
}) {
  return new SignJWT({
    purpose: PURPOSE,
    accountId: params.accountId,
    sessionId: params.sessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(accountsOrigin())
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${VAULT_UNLOCK_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function hasVaultUnlockConfirmation(
  headers: Headers,
  expected: { accountId: string; sessionId: string },
): Promise<boolean> {
  const token = cookieValue(headers, VAULT_UNLOCK_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: accountsOrigin(),
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return (
      payload.purpose === PURPOSE &&
      payload.accountId === expected.accountId &&
      payload.sessionId === expected.sessionId
    );
  } catch {
    return false;
  }
}
