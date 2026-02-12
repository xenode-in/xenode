import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Get the current session on the server side
 * Use this in Server Components and Server Actions
 */
export async function getServerSession() {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  return session;
}

/**
 * Require authentication — throws if no session
 * Use in API routes and Server Actions that require auth
 */
export async function requireAuth() {
  const session = await getServerSession();

  if (!session) {
    throw new Error("Unauthorized");
  }

  return session;
}
