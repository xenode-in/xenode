import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountsAuth } from "@/lib/auth";
import { hasVaultUnlockConfirmation } from "@/lib/vault-unlock-session";
import { applyTrustedSecondFactor } from "@/lib/trusted-second-factor";

export async function getAccountsSession(request?: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({
    headers: request?.headers ?? (await headers()),
  });
}

export async function requireAccountsPageSession(next = "/") {
  const session = await getAccountsSession();
  if (!session) redirect("/login");
  if (
    needsSecondFactor(session) &&
    !(await applyTrustedSecondFactor(session, await headers()))
  ) {
    redirect(`/two-factor?next=${encodeURIComponent(next)}`);
  }
  return session;
}

export function needsSecondFactor(session: {
  user: { twoFactorEnabled?: boolean | null };
  session: {
    authMethod?: string | null;
    twoFactorVerifiedAt?: Date | string | null;
  };
}) {
  return (
    session.user.twoFactorEnabled === true &&
    session.session.authMethod === "oauth" &&
    !session.session.twoFactorVerifiedAt
  );
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
