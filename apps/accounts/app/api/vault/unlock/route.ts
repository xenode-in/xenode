import { getServerProductOrigin } from "@xenode/config";
import { authorizeAccountsApiRequest } from "@/lib/api-session";
import { ACCOUNTS_RATE_LIMITS } from "@/lib/sensitive-actions";
import { NextResponse } from "next/server";
import { AuditEvent, UserVault } from "@xenode/database";
import { needsSecondFactor } from "@/lib/second-factor-state";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import {
  createVaultUnlockToken,
  VAULT_UNLOCK_COOKIE,
  vaultUnlockCookieAttributes,
} from "@/lib/vault-unlock-session";

function accountsOrigin() {
  return new URL(getServerProductOrigin("accounts"))
    .origin;
}

export async function POST(request: Request) {
  const denied = await authorizeAccountsApiRequest(request, { rateLimit: ACCOUNTS_RATE_LIMITS.vaultUnlock });
  if (denied) return denied;
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
  const body = (await request.json().catch(() => null)) as {
    method?: unknown;
  } | null;
  if (
    !body ||
    Object.keys(body).some((key) => key !== "method") ||
    (body.method !== "password" &&
      body.method !== "trusted-device" &&
      body.method !== "recovery")
  ) {
    return Response.json({ error: "Invalid unlock method" }, { status: 400 });
  }
  if (needsSecondFactor(session))
    return Response.json({ error: "Second factor required" }, { status: 403 });
  if (
    !(await UserVault.exists({
      accountId: session.user.id,
      passwordMode: "separate",
    }))
  ) {
    return Response.json(
      {
        error: "Choose a separate Vault password first.",
        code: "vault_password_migration_required",
      },
      { status: 409 },
    );
  }

  // Navigation confirmation only: authentication/2FA authorize server actions;
  // possession of client keys authorizes decryption. No Vault secret is sent here.

  const token = await createVaultUnlockToken({
    accountId: session.user.id,
    sessionId: session.session.id,
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VAULT_UNLOCK_COOKIE, token, vaultUnlockCookieAttributes());
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.local-unlock.continued",
    metadata: { method: body.method },
  }).catch(() => undefined);
  return response;
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request, accountsOrigin());
  } catch (response) {
    return response as Response;
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VAULT_UNLOCK_COOKIE, "", { ...vaultUnlockCookieAttributes(), maxAge: 0 });
  return response;
}
