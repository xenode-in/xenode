import {
  AuditEvent,
  connectDatabase,
  listExternalAccountsForUser,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";

function accountsOrigin() {
  return new URL(
    process.env.ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
  ).origin;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }

  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | { password?: unknown }
    | null;
  if (
    !body ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  ) {
    return Response.json(
      { error: "Use a password between 12 and 128 characters." },
      { status: 400 },
    );
  }

  await connectDatabase();
  const accounts = await listExternalAccountsForUser(session.user.id);
  const hasCredential = accounts.some(
    (account) => account.providerId === "credential" && account.password,
  );

  try {
    if (hasCredential) {
      await auth.api.verifyPassword({
        body: { password: body.password },
        headers: request.headers,
      });
    } else {
      await auth.api.setPassword({
        body: { newPassword: body.password },
        headers: request.headers,
      });
      await AuditEvent.create({
        accountId: session.user.id,
        action: "account.password.created",
        metadata: { source: "oauth-continuation" },
      }).catch(() => undefined);
    }
  } catch {
    return Response.json(
      { error: "The password could not be attached to this account." },
      { status: 400 },
    );
  }

  return Response.json({ ok: true, created: !hasCredential });
}
