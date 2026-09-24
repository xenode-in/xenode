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
  exceptIssuerSessionId?: string;
  action:
    | "browser_logout"
    | "device_revoked"
    | "sign_out_everywhere"
    | "password_changed"
    | "issuer_session_revoked";
}): Promise<number> {
  await connectDatabase();
  const filter = {
    accountId: args.accountId,
    ...(args.issuerSessionId
      ? { issuerSessionId: args.issuerSessionId }
      : args.exceptIssuerSessionId ? { issuerSessionId: { $ne: args.exceptIssuerSessionId } } : {}),
    expiresAt: { $gt: new Date() },
  };
  const sessions = await ProductSession.find(filter).lean();
  if (!sessions.length) return 0;

  const now = new Date();
  const activeSessionIds = sessions
    .filter((session) => !session.revokedAt)
    .map((session) => session.sessionId);
  let revokedProductSessionCount = 0;
  if (activeSessionIds.length) {
    const update = await ProductSession.updateMany(
      {
        ...filter,
        sessionId: { $in: activeSessionIds },
        revokedAt: { $exists: false },
        expiresAt: { $gt: now },
      },
      { $set: { revokedAt: now }, $inc: { sessionVersion: 1 } },
    );
    revokedProductSessionCount = update.modifiedCount;
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
      revokedProductSessionCount,
      notifiedProductSessionCount: sessions.length,
    },
  }).catch(() => undefined);
  return revokedProductSessionCount;
}

export function requireSameOrigin(request: Request, expectedOrigin: string) {
  const origin = request.headers.get("origin");
  if (origin !== expectedOrigin) {
    throw new Response("Forbidden", { status: 403 });
  }
}
