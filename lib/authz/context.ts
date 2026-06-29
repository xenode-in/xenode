import { type NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { AuthzError } from "./errors";

/**
 * The tenancy scope a request acts within.
 *
 * Today every request is `personal` — the acting user owns their own data.
 * When Organizations ship (better-auth `organization` plugin), `organization`
 * scope is populated from the session's active org + member role. This union is
 * the single seam the rest of the app reads, so flipping orgs on is localized to
 * `getAccessContext` below + the policy filters in `./policy`.
 */
export type AccessScope =
  | { type: "personal"; userId: string }
  | { type: "organization"; userId: string; orgId: string; role: string };

type BetterAuthSession = Awaited<ReturnType<typeof getServerSession>>;

export interface AccessContext {
  /** The acting user — always present, even under an organization scope. */
  userId: string;
  /** Tenancy scope. `personal` today; `organization` once the plugin is live. */
  scope: AccessScope;
  /** The underlying better-auth session (non-null). */
  session: NonNullable<BetterAuthSession>;
}

/**
 * Resolve the current access context, or null if unauthenticated.
 *
 * Pass `request` in API route handlers (so the expo() mobile plugin can read its
 * custom cookie header); omit it in Server Components / Server Actions.
 *
 * ── Organizations (future) ──────────────────────────────────────────────────
 * When the better-auth `organization` plugin is enabled, read
 * `session.session.activeOrganizationId` here, look up the caller's membership
 * role, and return `{ type: "organization", userId, orgId, role }`. No route or
 * policy caller needs to change — they already consume `ctx.scope`.
 */
export async function getAccessContext(
  request?: NextRequest,
): Promise<AccessContext | null> {
  const session = await getServerSession(request);
  if (!session?.user?.id) return null;

  const userId = session.user.id;

  // Personal scope today. Org resolution slots in right here later.
  return {
    userId,
    scope: { type: "personal", userId },
    session,
  };
}

/**
 * Require an access context — throws AuthzError(401) when unauthenticated.
 *
 * The thrown error's `message` is `"Unauthorized"`, matching the legacy
 * `requireAuth` convention, so existing route catch-blocks that test
 * `error.message === "Unauthorized"` keep mapping it to a 401.
 */
export async function requireAccessContext(
  request?: NextRequest,
): Promise<AccessContext> {
  const ctx = await getAccessContext(request);
  if (!ctx) {
    throw new AuthzError(401, "unauthorized", "Unauthorized");
  }
  return ctx;
}
