import {
  AuditEvent,
  ProductSession,
  connectDatabase,
} from "@xenode/database";
import { getAccountsAuth } from "@/lib/auth";

async function accountsSession(request: Request) {
  const auth = await getAccountsAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const session = await accountsSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await connectDatabase();
  const sessions = await ProductSession.find({
    accountId: session.user.id,
    expiresAt: { $gt: new Date() },
  })
    .sort({ revokedAt: 1, authenticatedAt: -1 })
    .select(
      "sessionId productId authenticatedAt sessionVersion expiresAt revokedAt",
    )
    .lean();

  return Response.json({
    sessions: sessions.map((productSession) => ({
      sessionId: productSession.sessionId,
      productId: productSession.productId,
      authenticatedAt: productSession.authenticatedAt,
      sessionVersion: productSession.sessionVersion,
      expiresAt: productSession.expiresAt,
      revokedAt: productSession.revokedAt ?? null,
    })),
  });
}

export async function DELETE(request: Request) {
  const session = await accountsSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { sessionId?: unknown }
    | null;
  if (!body || typeof body.sessionId !== "string") {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  await connectDatabase();
  const revokedAt = new Date();
  const productSession = await ProductSession.findOneAndUpdate(
    {
      sessionId: body.sessionId,
      accountId: session.user.id,
      revokedAt: { $exists: false },
    },
    {
      $set: { revokedAt },
      $inc: { sessionVersion: 1 },
    },
    { new: true },
  ).lean();
  if (!productSession) {
    return Response.json({ error: "Active product session not found" }, { status: 404 });
  }

  await AuditEvent.create({
    accountId: session.user.id,
    productId: productSession.productId,
    action: "product_session.revoked",
    metadata: {
      sessionId: productSession.sessionId,
      sessionVersion: productSession.sessionVersion,
    },
  }).catch(() => undefined);

  return Response.json({
    sessionId: productSession.sessionId,
    productId: productSession.productId,
    sessionVersion: productSession.sessionVersion,
    revokedAt,
  });
}
