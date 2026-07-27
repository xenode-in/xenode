import { productSlugSchema } from "@xenode/contracts";
import {
  AuditEvent,
  ProductSession,
  connectDatabase,
} from "@xenode/database";
import { publishProductSessionRevoked } from "@/lib/realtime";

export async function revokeProductSessions(args: {
  accountId: string;
  issuerSessionId?: string;
  action: "browser_logout" | "sign_out_everywhere";
}): Promise<number> {
  await connectDatabase();
  const filter = {
    accountId: args.accountId,
    ...(args.issuerSessionId
      ? { issuerSessionId: args.issuerSessionId }
      : {}),
    expiresAt: { $gt: new Date() },
  };
  const sessions = await ProductSession.find(filter).lean();
  if (!sessions.length) return 0;

  const now = new Date();
  const activeSessionIds = sessions
    .filter((session) => !session.revokedAt)
    .map((session) => session.sessionId);
  if (activeSessionIds.length) {
    await ProductSession.updateMany(
      { sessionId: { $in: activeSessionIds } },
      { $set: { revokedAt: now }, $inc: { sessionVersion: 1 } },
    );
  }
  await Promise.all(
    sessions.flatMap((session) => {
      const parsedProduct = productSlugSchema.safeParse(session.productId);
      if (!parsedProduct.success) return [];
      return [
        publishProductSessionRevoked({
          accountId: session.accountId,
          productId: parsedProduct.data,
          sessionId: session.sessionId,
          sessionExpiresAt: session.expiresAt,
        }),
      ];
    }),
  );
  await AuditEvent.create({
    accountId: args.accountId,
    action: `account.${args.action}`,
    metadata: {
      issuerSessionId: args.issuerSessionId ?? null,
      revokedProductSessionCount: activeSessionIds.length,
      notifiedProductSessionCount: sessions.length,
    },
  }).catch(() => undefined);
  return activeSessionIds.length;
}

export function requireSameOrigin(request: Request, expectedOrigin: string) {
  const origin = request.headers.get("origin");
  if (origin !== expectedOrigin) {
    throw new Response("Forbidden", { status: 403 });
  }
}
