import { ProductSession, connectDatabase } from "@xenode/database";
import { getAccountsSession } from "@/lib/session";

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
  const session = await getAccountsSession(request);
  if (!session) return Response.json({ ok: true });
  await connectDatabase();
  await ProductSession.updateMany(
    { accountId: session.user.id, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() }, $inc: { sessionVersion: 1 } },
  );
  return Response.json({ ok: true });
}
