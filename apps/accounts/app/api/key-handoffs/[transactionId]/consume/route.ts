import {
  AuditEvent,
  KeyHandoff,
  ProductSession,
  connectDatabase,
} from "@xenode/database";

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function hash(value: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const authorization = request.headers.get("authorization");
  const sessionId = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !sessionId ||
    !body ||
    typeof body.clientId !== "string" ||
    typeof body.productId !== "string" ||
    typeof body.spaceId !== "string" ||
    typeof body.destinationOrigin !== "string" ||
    typeof body.state !== "string" ||
    typeof body.nonce !== "string"
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDatabase();
  const session = await ProductSession.findOne({
    sessionId,
    productId: body.productId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { transactionId } = await params;
  const handoff = await KeyHandoff.findOneAndDelete({
    transactionId,
    accountId: session.accountId,
    clientId: body.clientId,
    productId: body.productId,
    spaceId: body.spaceId,
    destOrigin: body.destinationOrigin,
    stateHash: await hash(body.state),
    nonceHash: await hash(body.nonce),
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!handoff) {
    return Response.json(
      { error: "Handoff missing, expired, mismatched, or consumed" },
      { status: 410 },
    );
  }

  await AuditEvent.create({
    accountId: session.accountId,
    spaceId: handoff.spaceId,
    productId: handoff.productId,
    action: "key_handoff.consumed",
    metadata: { transactionId, clientId: handoff.clientId },
  }).catch(() => undefined);

  return Response.json({
    transactionId,
    ciphertext: handoff.ciphertext,
    ephemeralPublicKeyFingerprint: handoff.ephemeralPublicKeyFingerprint,
  });
}
