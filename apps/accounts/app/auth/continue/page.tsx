import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAccountOnboardingReadiness } from "@xenode/database";
import { requireAccountsPageSession } from "@/lib/session";
import { hasVaultUnlockConfirmation } from "@/lib/vault-unlock-session";
import { VaultUnlockGate } from "./VaultUnlockGate";

function safeNext(value: string | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function AuthContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireAccountsPageSession();
  const next = safeNext((await searchParams).next);
  if (session.user.emailVerified === false) {
    redirect(
      `/verify-email?email=${encodeURIComponent(session.user.email)}&next=${encodeURIComponent(`/auth/continue?next=${encodeURIComponent(next)}`)}`,
    );
  }
  const readiness = await getAccountOnboardingReadiness(session.user.id);
  if (
    !readiness.profileOnboarded ||
    !readiness.hasVault ||
    !readiness.hasPasswordEnvelope
  ) {
    redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }
  if (!readiness.hasPasswordCredential) {
    redirect(`/auth/password?next=${encodeURIComponent(next)}`);
  }
  const unlocked = await hasVaultUnlockConfirmation(await headers(), {
    accountId: session.user.id,
    sessionId: session.session.id,
  });
  if (unlocked) redirect(next);

  return (
    <VaultUnlockGate
      accountId={session.user.id}
      accountLabel={session.user.email ?? session.user.name ?? "your account"}
      next={next}
    />
  );
}
