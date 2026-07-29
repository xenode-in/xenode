import { headers as nextHeaders } from "next/headers";
import { type NextRequest } from "next/server";
import mongoose from "mongoose";
import {
  getAccountOnboardingReadiness,
  ProductSession,
} from "@xenode/database";
import dbConnect from "@/lib/mongodb";
import { parseDriveSessionCookie } from "@/lib/auth/product-cookie";
import { User } from "@/models/User";

export const DRIVE_SESSION_COOKIE = "xenode_drive_session";

/** User-doc fields that must never leave the server. */
const SENSITIVE_USER_FIELDS =
  "-authVerifier -authSalt -twoFactorSecret -twoFactorBackupCodes";

export interface DriveSessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  onboarded?: boolean;
  encryptByDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

export interface DriveSession {
  user: DriveSessionUser;
  session: {
    id: string;
    /** Legacy alias of `id` kept for callers that read `session.token`. */
    token: string;
    userId: string;
    productId: "drive";
    issuerSessionId: string;
    sessionVersion: number;
    activeOrganizationId: string | null;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date;
  };
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
}

/**
 * Extract the Drive ProductSession id from the request: the host-only
 * `xenode_drive_session` cookie for web, or `Authorization: Bearer <id>` for
 * non-browser clients (mobile re-integrates via the `xenode-mobile` OIDC
 * client and carries its ProductSession the same way).
 */
async function resolveCredential(
  request?: NextRequest,
): Promise<{ sessionId: string; sessionVersion: number } | null> {
  const h = request ? request.headers : await nextHeaders();
  const authorization = h.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return parseDriveSessionCookie(token);
  }
  const value = cookieValue(h.get("cookie"), DRIVE_SESSION_COOKIE);
  return value ? parseDriveSessionCookie(value) : null;
}

/**
 * Get the current Drive session on the server side.
 *
 * Post OIDC cutover this resolves a Drive `ProductSession` minted by
 * /auth/callback (Accounts is the identity authority) and hydrates the user
 * profile from the shared `user` collection, preserving the legacy
 * `{ user, session }` shape every route already consumes. Revoked and
 * expired sessions never resolve.
 *
 * Pass `request` in API route handlers; without it, falls back to Next.js
 * headers() for Server Components / Server Actions.
 */
export async function getServerSession(
  request?: NextRequest,
): Promise<DriveSession | null> {
  const credential = await resolveCredential(request);
  if (!credential) return null;

  await dbConnect();
  const productSession = await ProductSession.findOne({
    sessionId: credential.sessionId,
    productId: "drive",
    sessionVersion: credential.sessionVersion,
    issuerSessionId: { $type: "string" },
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!productSession) return null;
  const readiness = await getAccountOnboardingReadiness(
    productSession.accountId,
  );
  if (!readiness.complete) return null;

  if (!mongoose.isValidObjectId(productSession.accountId)) return null;
  const user = await User.findById(productSession.accountId)
    .select(SENSITIVE_USER_FIELDS)
    .lean();
  if (!user) return null;

  const { _id, ...profile } = user as unknown as { _id: unknown } & Record<
    string,
    unknown
  >;
  return {
    user: { ...profile, id: String(_id) } as DriveSessionUser,
    session: {
      id: productSession.sessionId,
      token: productSession.sessionId,
      userId: productSession.accountId,
      productId: "drive",
      issuerSessionId: productSession.issuerSessionId,
      sessionVersion: productSession.sessionVersion,
      activeOrganizationId: productSession.activeOrganizationId ?? null,
      createdAt: productSession.authenticatedAt,
      updatedAt: productSession.updatedAt,
      expiresAt: productSession.expiresAt,
    },
  };
}

/**
 * Require authentication — throws "Unauthorized" if no session found.
 *
 * In API routes, always pass the NextRequest:
 *   const session = await requireAuth(request);
 *
 * In Server Components / Server Actions (no request object):
 *   const session = await requireAuth();
 */
export async function requireAuth(request?: NextRequest): Promise<DriveSession> {
  const session = await getServerSession(request);
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
