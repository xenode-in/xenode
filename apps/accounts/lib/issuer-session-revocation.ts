import { ProductSession, connectDatabase } from "@xenode/database";
import { revokeProductSessions } from "@/lib/logout-coordinator";

/** Called by Better Auth before deleting a browser issuer session. */
export async function revokeIssuerProductsBeforeSessionDelete(session: {
  id: string;
  userId: string;
}): Promise<void> {
  await connectDatabase();
  const active = await ProductSession.exists({
    accountId: session.userId,
    issuerSessionId: session.id,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!active) return;
  await revokeProductSessions({
    accountId: session.userId,
    issuerSessionId: session.id,
    action: "issuer_session_revoked",
  });
}
