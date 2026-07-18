import { cookies } from "next/headers";
import { ProductSession } from "@xenode/database";
import dbConnect from "@/lib/mongodb";

export const DRIVE_SESSION_COOKIE = "xenode_drive_session";

/**
 * Resolve the Drive ProductSession from the host-only session cookie.
 *
 * Returns null when the cookie is absent, the session is revoked, or it has
 * expired — the caller decides whether that means 401 or a login redirect.
 * Mirrors apps/photos/lib/session.ts. This is the R1 groundwork seam: once
 * the Accounts OIDC cutover completes, `requireAuth`/`getServerSession`
 * resolve through here instead of the platform-local better-auth session.
 */
export async function getDriveProductSession() {
  await dbConnect();
  const sessionId = (await cookies()).get(DRIVE_SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return ProductSession.findOne({
    sessionId,
    productId: "drive",
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();
}
