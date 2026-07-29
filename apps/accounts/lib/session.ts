import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountsAuth } from "@/lib/auth";
import { hasVaultUnlockConfirmation } from "@/lib/vault-unlock-session";

export async function getAccountsSession(request?: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({
    headers: request?.headers ?? (await headers()),
  });
}

export async function requireAccountsPageSession() {
  const session = await getAccountsSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireUnlockedAccountsPageSession(next = "/") {
  const session = await requireAccountsPageSession();
  const unlocked = await hasVaultUnlockConfirmation(await headers(), {
    accountId: session.user.id,
    sessionId: session.session.id,
  });
  if (!unlocked) {
    redirect(`/auth/continue?next=${encodeURIComponent(next)}`);
  }
  return session;
}
