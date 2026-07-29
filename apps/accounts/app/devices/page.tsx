import { ProductSession, connectDatabase } from "@xenode/database";
import { headers } from "next/headers";
import { AccountShell } from "@/components/AccountShell";
import { DevicesList } from "@/components/DevicesList";
import { getAccountsAuth } from "@/lib/auth";
import { groupAccountDevices } from "@/lib/device-sessions";
import { requireUnlockedAccountsPageSession } from "@/lib/session";

export default async function DevicesPage() {
  const session = await requireUnlockedAccountsPageSession("/devices");
  await connectDatabase();
  const auth = await getAccountsAuth();
  const requestHeaders = await headers();
  const now = new Date();
  const historyCutoff = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const [browserSessions, productSessions] = await Promise.all([
    auth.api.listSessions({ headers: requestHeaders }),
    ProductSession.find({
      accountId: session.user.id,
      $or: [
        { expiresAt: { $gt: now } },
        { authenticatedAt: { $gte: historyCutoff } },
      ],
    })
      .sort({ authenticatedAt: -1 })
      .select(
        "sessionId issuerSessionId productId authenticatedAt expiresAt revokedAt",
      )
      .lean(),
  ]);
  const devices = groupAccountDevices({
    browserSessions,
    productSessions,
    currentSessionId: session.session.id,
    now,
  });

  return (
    <AccountShell user={session.user}>
      <main className="mx-auto w-full max-w-[1200px] border-x border-border/65 px-5 py-10 md:px-10 md:py-14">
        <DevicesList initialDevices={devices} />
      </main>
    </AccountShell>
  );
}
