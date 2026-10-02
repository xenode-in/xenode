import { createHash, randomBytes } from "node:crypto";
import {
  TrustedSecondFactor,
  connectDatabase,
  getDatabase,
  createAuthSecurityRepository,
} from "@xenode/database";
import { needsSecondFactor } from "@/lib/second-factor-state";

export const TRUSTED_SECOND_FACTOR_COOKIE =
  "xenode_accounts_2fa_trusted";
export const TRUSTED_SECOND_FACTOR_MAX_AGE = 30 * 24 * 60 * 60;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function cookieValue(headers: Headers, name: string) {
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

export async function createTrustedSecondFactor(accountId: string) {
  await connectDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await TrustedSecondFactor.create({
    accountId,
    tokenHash: tokenHash(token),
    expiresAt: new Date(now.getTime() + TRUSTED_SECOND_FACTOR_MAX_AGE * 1000),
    lastUsedAt: now,
  });
  return token;
}

export async function applyTrustedSecondFactor(
  session: {
    user: { id: string; twoFactorEnabled?: boolean | null };
    session: {
      id: string;
      authMethod?: string | null;
      twoFactorVerifiedAt?: Date | string | null;
    };
  },
  headers: Headers,
) {
  if (!needsSecondFactor(session)) return true;
  const token = cookieValue(headers, TRUSTED_SECOND_FACTOR_COOKIE);
  if (!token) return false;
  await connectDatabase();
  const trusted = await TrustedSecondFactor.findOneAndUpdate(
    {
      accountId: session.user.id,
      tokenHash: tokenHash(token),
      expiresAt: { $gt: new Date() },
      revokedAt: { $exists: false },
    },
    { $set: { lastUsedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!trusted) return false;
  const verifiedAt = new Date();
  const updated = await createAuthSecurityRepository(getDatabase()).markSecondFactorVerified({
    accountId: session.user.id,
    sessionId: session.session.id,
    verifiedAt,
    method: "trusted-device",
  });
  if (!updated) return false;
  session.session.authMethod = "trusted-device";
  session.session.twoFactorVerifiedAt = verifiedAt;
  return true;
}
