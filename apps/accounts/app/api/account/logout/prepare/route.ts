import {
  BROWSER_LOGOUT_PRODUCTS,
  deriveBrowserLogoutCleanupToken,
  findBrowserLogoutTransaction,
} from "@xenode/database";
import { getAccountsSession } from "@/lib/session";
import {
  requireSameOrigin,
  revokeProductSessions,
} from "@/lib/logout-coordinator";

export async function POST(request: Request) {
  const accountsOrigin =
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";
  try {
    requireSameOrigin(request, new URL(accountsOrigin).origin);
  } catch (response) {
    return response as Response;
  }
  const body = (await request.json().catch(() => null)) as
    | { transaction?: unknown }
    | null;
  if (!body || typeof body.transaction !== "string") {
    return Response.json({ error: "transaction is required" }, { status: 400 });
  }
  const transactionToken = body.transaction;
  const transaction = await findBrowserLogoutTransaction(transactionToken);
  if (!transaction) {
    return Response.json(
      { error: "Logout transaction expired" },
      { status: 410 },
    );
  }
  const accountsSession = await getAccountsSession(request);
  if (
    accountsSession &&
    accountsSession.user.id !== transaction.accountId
  ) {
    return Response.json({ error: "Account mismatch" }, { status: 409 });
  }

  await revokeProductSessions({
    accountId: transaction.accountId,
    issuerSessionId: transaction.issuerSessionId,
    action: "browser_logout",
  });

  const origins = {
    drive:
      process.env.DRIVE_ORIGIN ??
      (process.env.NODE_ENV === "production"
        ? "https://drive.xenode.in"
        : "http://localhost:3000"),
    photos:
      process.env.PHOTOS_ORIGIN ??
      (process.env.NODE_ENV === "production"
        ? "https://photos.xenode.in"
        : "http://localhost:3002"),
  };
  return Response.json({
    cleanupUrls: BROWSER_LOGOUT_PRODUCTS.map((productId) => ({
      productId,
      url: new URL(
        `/auth/logout/cleanup?ticket=${encodeURIComponent(
          deriveBrowserLogoutCleanupToken(transactionToken, productId),
        )}`,
        origins[productId],
      ).toString(),
    })),
    signOutAccounts:
      accountsSession?.session.id === transaction.issuerSessionId,
  });
}
