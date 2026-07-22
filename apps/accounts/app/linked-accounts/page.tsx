import { AccountShell } from "@/components/AccountShell";
import { LinkedAccounts } from "@/components/LinkedAccounts";
import { requireAccountsPageSession } from "@/lib/session";

export default async function LinkedAccountsPage() {
  const session = await requireAccountsPageSession();
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  const accounts = (await listExternalAccountsForUser(session.user.id))
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
        <p className="eyebrow">Connectors</p>
        <h1>Linked accounts</h1>
        <p className="lede">External accounts authorize optional integrations. They never replace your Xenode email or username as the login identity.</p>
        <LinkedAccounts googleConfigured={googleConfigured} initialAccounts={accounts} />
      </main>
    </AccountShell>
  );
}
import { listExternalAccountsForUser } from "@xenode/database";
