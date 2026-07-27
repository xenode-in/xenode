import { ProductSession, connectDatabase } from "@xenode/database";
import { AccountShell } from "@/components/AccountShell";
import { DevicesList } from "@/components/DevicesList";
import { requireAccountsPageSession } from "@/lib/session";

export default async function DevicesPage() {
  const session = await requireAccountsPageSession();
  await connectDatabase();
  const productSessions = await ProductSession.find({
    accountId: session.user.id,
    expiresAt: { $gt: new Date() },
  })
    .sort({ revokedAt: 1, authenticatedAt: -1 })
    .select("sessionId productId authenticatedAt expiresAt revokedAt")
    .lean();
  const sessions = productSessions.map((item) => ({
    sessionId: item.sessionId,
    productId: item.productId,
    authenticatedAt: item.authenticatedAt.toISOString(),
    expiresAt: item.expiresAt.toISOString(),
    revokedAt: item.revokedAt?.toISOString() ?? null,
  }));
  return (
    <AccountShell user={session.user}>
      <main className="page">
        <p className="eyebrow">Product access</p>
        <h1>Devices</h1>
        <p className="lede">Review product access for your Xenode sessions. Normal sign-out closes every product in this browser; use “Sign out everywhere” only when all devices should be revoked.</p>
        <DevicesList initialSessions={sessions} />
      </main>
    </AccountShell>
  );
}
