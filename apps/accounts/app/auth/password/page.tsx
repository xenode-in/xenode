import { redirect } from "next/navigation";
import {
  UserVault,
  connectDatabase,
  listExternalAccountsForUser,
} from "@xenode/database";
import { requireAccountsPageSession } from "@/lib/session";
import { PasswordCredentialForm } from "./PasswordCredentialForm";

function safeNext(value: string | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function OAuthPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireAccountsPageSession();
  const next = safeNext((await searchParams).next);
  await connectDatabase();
  const [vault, accounts] = await Promise.all([
    UserVault.findOne({ accountId: session.user.id })
      .select("_id passwordEnvelope")
      .lean(),
    listExternalAccountsForUser(session.user.id),
  ]);
  const hasCredential = accounts.some(
    (account) => account.providerId === "credential" && account.password,
  );
  if (hasCredential) redirect(next);
  if (!vault) redirect(`/onboarding?next=${encodeURIComponent(next)}`);

  return (
    <PasswordCredentialForm
      accountLabel={session.user.email ?? session.user.name ?? "your account"}
      needsRecovery={!vault.passwordEnvelope}
      next={next}
    />
  );
}
