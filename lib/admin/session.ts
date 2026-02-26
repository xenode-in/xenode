import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const ADMIN_COOKIE = "xnode_admin_session";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "change_me_in_production";

if (process.env.NODE_ENV === "production" && !process.env.ADMIN_JWT_SECRET) {
  throw new Error("ADMIN_JWT_SECRET env variable is required in production");
}

export interface AdminJWTPayload {
  id: string;
  username: string;
  role: "super_admin" | "admin";
}

function getSecretKey() {
  return new TextEncoder().encode(ADMIN_JWT_SECRET);
}

/**
 * Create a signed JWT and set it as an HttpOnly cookie.
 */
export async function createAdminSession(payload: AdminJWTPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
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

    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as AdminJWTPayload;
  } catch {
    return null;
  }
}

/**
 * Read and verify the admin session from a NextRequest (proxy / middleware helpers).
 */
export async function getAdminSessionFromRequest(
  req: NextRequest
): Promise<AdminJWTPayload | null> {
  try {
    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as AdminJWTPayload;
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
