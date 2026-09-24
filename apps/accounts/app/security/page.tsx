import {
  AccountPasskeyBinding,
  VaultPasskey,
  connectDatabase,
  getDatabase,
  createAuthSecurityRepository,
  listExternalAccountsForUser,
} from "@xenode/database";
import { AccountShell } from "@/components/AccountShell";
import { SecurityCenter } from "@/components/SecurityCenter";
import { requireUnlockedAccountsPageSession } from "@/lib/session";

export default async function SecurityPage() {
  const session = await requireUnlockedAccountsPageSession("/security");
  await connectDatabase();
  const [accounts, passkeyRows, bindings, legacyRows] = await Promise.all([
    listExternalAccountsForUser(session.user.id),
    createAuthSecurityRepository(getDatabase()).listPasskeysForUser(session.user.id),
    AccountPasskeyBinding.find({ accountId: session.user.id }).lean(),
    VaultPasskey.find({
      accountId: session.user.id,
      status: "active",
    })
      .select("credentialId name createdAt lastUsedAt")
      .lean(),
  ]);
  const hasCredential = accounts.some(
    (account) => account.providerId === "credential" && account.password,
  );
  const boundIds = new Set(bindings.map((binding) => binding.passkeyId));
  const initialPasskeys = passkeyRows
    .filter((passkey) => boundIds.has(passkey.id))
    .map((passkey) => ({
      id: passkey.id,
      name: passkey.name ?? "Passkey",
      credentialId: passkey.credentialID,
      createdAt: (passkey.createdAt ?? new Date()).toISOString(),
    }));
  const initialLegacy = legacyRows.map((passkey) => ({
    id: passkey.credentialId,
    name: passkey.name ?? "Older Vault passkey",
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
  }));
  return (
    <AccountShell user={session.user}>
      <main className="mx-auto w-full max-w-[1050px] px-5 py-10 md:px-8 md:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Security
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">
          Simple controls. Strong protection.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Manage the ways you sign in and unlock your encrypted Vault. Your
          Account Root Key never leaves this browser.
        </p>
        <div className="mt-8">
          <SecurityCenter
            accountId={session.user.id}
            email={session.user.email}
            hasCredential={hasCredential}
            twoFactorEnabled={session.user.twoFactorEnabled === true}
            initialPasskeys={initialPasskeys}
            initialLegacy={initialLegacy}
          />
        </div>
      </main>
    </AccountShell>
  );
}
