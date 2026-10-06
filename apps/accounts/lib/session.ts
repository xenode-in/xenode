import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountsAuth } from "@/lib/auth";
import { hasVaultUnlockConfirmation } from "@/lib/vault-unlock-session";
import { applyTrustedSecondFactor } from "@/lib/trusted-second-factor";
import { needsSecondFactor } from "@/lib/second-factor-state";

export async function getAccountsSession(request?: Request) {
  // Headers first: a page render becomes request-time before any database work.
  const requestHeaders = request?.headers ?? (await headers());
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: requestHeaders });
}

export async function requireAccountsPageSession(next = "/") {
  const session = await getAccountsSession();
  if (!session) redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
  if (
    needsSecondFactor(session) &&
    !(await applyTrustedSecondFactor(session, await headers()))
  ) {
    redirect(`/two-factor?next=${encodeURIComponent(next)}`);
  }
  return session;
}

export async function requireUnlockedAccountsPageSession(next = "/") {
  const session = await requireAccountsPageSession(next);
  const unlocked = await hasVaultUnlockConfirmation(await headers(), {
    accountId: session.user.id,
    sessionId: session.session.id,
  });
  if (!unlocked) {
    redirect(`/auth/continue?next=${encodeURIComponent(next)}`);
  }
  return session;
}
