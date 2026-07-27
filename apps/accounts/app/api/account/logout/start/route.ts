import { createBrowserLogoutTransaction } from "@xenode/database";
import { getAccountsSession } from "@/lib/session";
import { requireSameOrigin } from "@/lib/logout-coordinator";

export async function POST(request: Request) {
  const origin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  try {
    requireSameOrigin(request, new URL(origin).origin);
  } catch (response) {
    return response as Response;
  }
  const session = await getAccountsSession(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const transaction = await createBrowserLogoutTransaction({
    accountId: session.user.id,
    issuerSessionId: session.session.id,
    initiatingProduct: "accounts",
  });
  return Response.json({
    logoutUrl: `/logout?transaction=${encodeURIComponent(transaction.token)}`,
    expiresAt: transaction.expiresAt,
  });
}
