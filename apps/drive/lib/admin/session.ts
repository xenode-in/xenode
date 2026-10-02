import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { Admin, connectDatabase } from "@xenode/database";

const ADMIN_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-Xenode_admin_session"
  : "Xenode_admin_session";
const ADMIN_ISSUER = "xenode-drive-admin";
const ADMIN_AUDIENCE = "xenode-admin";
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export interface AdminJWTPayload {
  id: string;
  username: string;
  role: "super_admin" | "admin";
  sessionVersion: number;
}

function getSecretKey() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("ADMIN_JWT_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}

async function resolveAdminToken(token: string): Promise<AdminJWTPayload | null> {
  const { payload, protectedHeader } = await jwtVerify(token, getSecretKey(), {
    algorithms: ["HS256"], issuer: ADMIN_ISSUER, audience: ADMIN_AUDIENCE,
  });
  if (protectedHeader.typ !== "JWT" || typeof payload.id !== "string" || !/^[a-f0-9]{24}$/u.test(payload.id) ||
    typeof payload.sessionVersion !== "number" || !Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion < 1 ||
    payload.aud !== ADMIN_AUDIENCE ||
    (payload.role !== "admin" && payload.role !== "super_admin") ||
    !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
    Number(payload.iat) > Math.floor(Date.now() / 1000) || Number(payload.exp) <= Number(payload.iat) ||
    Number(payload.exp) - Number(payload.iat) > ADMIN_SESSION_SECONDS) return null;
  await connectDatabase();
  const admin = await Admin.findOne({
    _id: payload.id, isActive: true, sessionVersion: payload.sessionVersion, role: payload.role,
  }).select("username role sessionVersion").read("primary").lean();
  if (!admin) return null;
  return { id: admin._id.toString(), username: admin.username, role: admin.role, sessionVersion: admin.sessionVersion };
}

/**
 * Create a signed JWT and set it as an HttpOnly cookie.
 */
export async function createAdminSession(identity: { id: string; sessionVersion: number }) {
  await connectDatabase();
  const admin = await Admin.findOne({ _id: identity.id, sessionVersion: identity.sessionVersion, isActive: true })
    .select("username role sessionVersion").read("primary").lean();
  if (!admin) throw new Error("Admin credentials changed; sign in again");
  const payload: AdminJWTPayload = { id: admin._id.toString(), username: admin.username, role: admin.role, sessionVersion: admin.sessionVersion };
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });

  return token;
}

/**
 * Read and verify the admin session from cookies (Server Components / API routes).
 */
export async function getAdminSession(): Promise<AdminJWTPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_COOKIE)?.value;
    if (!token) return null;

    return await resolveAdminToken(token);
  } catch {
    return null;
  }
}

/**
 * Read and verify the admin session from a NextRequest (proxy / middleware helpers).
 */
export async function getAdminSessionFromRequest(
  req: NextRequest,
): Promise<AdminJWTPayload | null> {
  try {
    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!token) return null;

    return await resolveAdminToken(token);
  } catch {
    return null;
  }
}

/**
 * Destroy the admin session cookie.
 */
export async function destroyAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}

/**
 * Server-side guard — call in layouts / API routes.
 * Returns the payload or throws.
 */
export async function requireAdminSession(): Promise<AdminJWTPayload> {
  const session = await getAdminSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

/**
 * Super-admin only guard.
 */
export async function requireSuperAdminSession(): Promise<AdminJWTPayload> {
  const session = await requireAdminSession();
  if (session.role !== "super_admin") {
    throw new Error("Forbidden");
  }
  return session;
}
