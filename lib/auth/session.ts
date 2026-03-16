import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { type NextRequest } from "next/server";

/**
 * Get the current session on the server side.
 *
 * Pass `request` in API route handlers so the expo() plugin can read
 * the `x-better-auth-cookie` header sent by the mobile client.
 *
 * Without `request`, falls back to Next.js headers() — use this only
 * in Server Components and Server Actions where no request object exists.
 */
export async function getServerSession(request?: NextRequest) {
  const h = request
    ? request.headers                // live headers — expo() plugin can read x-better-auth-cookie
    : await headers();               // frozen copy — for Server Components / Server Actions only

  const session = await getAuth().api.getSession({ headers: h });
  return session;
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
export async function requireAuth(request?: NextRequest) {
  const session = await getServerSession(request);

  if (!session) {
    throw new Error("Unauthorized");
  }

  return session;
}
