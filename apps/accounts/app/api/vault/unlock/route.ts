import { NextResponse } from "next/server";
import { AuditEvent } from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/logout-coordinator";
import {
  createVaultUnlockToken,
  VAULT_UNLOCK_COOKIE,
  VAULT_UNLOCK_TTL_SECONDS,
} from "@/lib/vault-unlock-session";

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
    | { method?: unknown; password?: unknown }
    | null;
  if (
    !body ||
    (body.method !== "password" && body.method !== "trusted-device")
  ) {
    return Response.json({ error: "Invalid unlock method" }, { status: 400 });
  }
  if (body.method === "password") {
    if (
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 128
    ) {
      return Response.json({ error: "Invalid password" }, { status: 400 });
    }
    try {
      await auth.api.verifyPassword({
        body: { password: body.password },
        headers: request.headers,
      });
    } catch {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }
  }

  const token = await createVaultUnlockToken({
    accountId: session.user.id,
    sessionId: session.session.id,
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VAULT_UNLOCK_COOKIE, token, {
    httpOnly: true,
    secure: accountsOrigin().startsWith("https://"),
    sameSite: "strict",
    path: "/",
    maxAge: VAULT_UNLOCK_TTL_SECONDS,
  });
  await AuditEvent.create({
    accountId: session.user.id,
    action: "vault.unlocked",
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
  response.cookies.set(VAULT_UNLOCK_COOKIE, "", {
    httpOnly: true,
    secure: accountsOrigin().startsWith("https://"),
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
