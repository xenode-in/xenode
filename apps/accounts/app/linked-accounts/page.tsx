import { AccountShell } from "@/components/AccountShell";
import { LinkedAccounts } from "@/components/LinkedAccounts";
import { requireAccountsPageSession } from "@/lib/session";

export default async function LinkedAccountsPage() {
  const session = await requireAccountsPageSession();
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  const githubConfigured = Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
  const allAccounts = await listExternalAccountsForUser(session.user.id);
  const hasCredential = allAccounts.some(
    (account) => account.providerId === "credential",
  );
  const accounts = allAccounts
    .filter((account) => account.providerId && account.providerId !== "credential")
    .map((account) => ({
      id: String(account._id),
      accountId: account.accountId ?? "",
      providerId: account.providerId ?? "unknown",
      scopes: account.scope?.split(",").filter(Boolean) ?? [],
      createdAt: account.createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  return (
    <AccountShell user={session.user}>
      <main className="page">
        <p className="eyebrow">Sign-in methods</p>
        <h1>Linked accounts</h1>
        <p className="lede">Use verified Google and GitHub identities to sign in. OAuth authenticates you; it never becomes an encryption key.</p>
        <LinkedAccounts
          configured={{ google: googleConfigured, github: githubConfigured }}
          hasCredential={hasCredential}
          initialAccounts={accounts}
        />
      </main>
    </AccountShell>
  );
}
import { listExternalAccountsForUser } from "@xenode/database";
