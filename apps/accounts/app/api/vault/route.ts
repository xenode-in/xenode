import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { UserVault, connectDatabase } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import {
  VAULT_CLIENT_HEADER,
  VAULT_CLIENT_VERSION,
} from "@/lib/vault-protocol";

async function sessionFor(request: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  // This is a compatibility check, not authentication. Older browser bundles
  // must not receive a new local-only wrap and subsequently send its password
  // through their retired server-confirmation flow.
  if (request.headers.get(VAULT_CLIENT_HEADER) !== VAULT_CLIENT_VERSION) {
    return Response.json(
      {
        error: "Reload Xenode to use separate Vault passwords.",
        code: "vault_client_update_required",
      },
      { status: 409 },
    );
  }
  const denied = await authorizeAccountsApiRequest(request);
  if (denied) return denied;
  const session = await sessionFor(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  await connectDatabase();
  const vault = await UserVault.findOne({ accountId: session.user.id }).lean();
  return Response.json({ accountId: session.user.id, vault: vault ?? null });
}
