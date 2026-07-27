import { createBrowserLogoutTransaction } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { getAccountsSession } from "@/lib/session";
import {
  requireSameOrigin,
  revokeProductSessions,
} from "@/lib/logout-coordinator";

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
  const transaction = await createBrowserLogoutTransaction({
    accountId: session.user.id,
    issuerSessionId: session.session.id,
    initiatingProduct: "accounts",
  });
  await revokeProductSessions({
    accountId: session.user.id,
    action: "sign_out_everywhere",
  });
  const auth = await getAccountsAuth();
  await auth.api.revokeSessions({ headers: request.headers });
  return Response.json({
    ok: true,
    logoutUrl: `/logout?transaction=${encodeURIComponent(transaction.token)}`,
  });
}
