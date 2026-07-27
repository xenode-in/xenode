import { getAccountsSession } from "@/lib/session";
import {
  requireSameOrigin,
  revokeProductSessions,
} from "@/lib/logout-coordinator";

/**
 * POST /api/account/global-signout — revoke every product session (Drive,
 * Photos, …) for the signed-in account. Called by the /logout flow so that
 * signing out of the account tears down the product sessions too, instead of
 * leaving them independently live (and instead of the product's own sign-out
 * silently re-authenticating via the still-valid Accounts SSO session).
 *
 * The Better Auth account session itself is cleared separately via
 * /api/auth/sign-out. No session ⇒ nothing to revoke ⇒ still a success.
 */
export async function POST(request: Request) {
  const origin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  try {
    requireSameOrigin(request, new URL(origin).origin);
  } catch (response) {
    return response as Response;
  }
  const session = await getAccountsSession(request);
  if (!session) return Response.json({ ok: true });
  await revokeProductSessions({
    accountId: session.user.id,
    issuerSessionId: session.session.id,
    action: "browser_logout",
  });
  return Response.json({ ok: true });
}
