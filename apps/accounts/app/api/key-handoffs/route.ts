import { productSlugSchema, spaceIdSchema } from "@xenode/contracts";
import { AuditEvent, KeyHandoff, connectDatabase } from "@xenode/database";
import { FIRST_PARTY_CLIENTS } from "@xenode/identity-core";
import { resolveSpaceAccess } from "@xenode/spaces";
import { getAccountsAuth } from "@/lib/auth";

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

export async function POST(request: Request) {
  const auth = await getAccountsAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  const client = FIRST_PARTY_CLIENTS.find(
    (candidate) => candidate.clientId === body.clientId,
  );
  const parsedSpaceId = spaceIdSchema.safeParse(body.spaceId);
  const destinationOrigin =
    typeof body.destinationOrigin === "string" ? body.destinationOrigin : "";
  const originAllowed =
    client?.redirectUris.some(
      (redirect) => new URL(redirect).origin === destinationOrigin,
    ) ?? false;
  if (
    !client ||
    client.productId !== body.productId ||
    !originAllowed ||
    typeof body.transactionId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(body.transactionId) ||
    !parsedSpaceId.success ||
    typeof body.ephemeralPublicKeyFingerprint !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(body.ephemeralPublicKeyFingerprint) ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length < 32 ||
    body.ciphertext.length > 16_384 ||
    typeof body.state !== "string" ||
    body.state.length < 16 ||
    typeof body.nonce !== "string" ||
    body.nonce.length < 16
  ) {
    return Response.json({ error: "Invalid handoff binding" }, { status: 400 });
  }

  const productId = productSlugSchema.parse(client.productId);
  await connectDatabase();
  try {
    await resolveSpaceAccess({
      accountId: session.user.id,
      spaceId: parsedSpaceId.data,
      productId,
    });
  } catch {
    return Response.json({ error: "Space not found" }, { status: 404 });
  }
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
  try {
    await KeyHandoff.create({
      transactionId: String(body.transactionId),
      accountId: session.user.id,
      clientId: String(body.clientId),
      productId,
      spaceId: parsedSpaceId.data,
      destOrigin: destinationOrigin,
      ephemeralPublicKeyFingerprint: String(body.ephemeralPublicKeyFingerprint),
      ciphertext: String(body.ciphertext),
      stateHash: await hash(String(body.state)),
      nonceHash: await hash(String(body.nonce)),
      expiresAt,
    });
  } catch {
    return Response.json(
      { error: "Handoff transaction already exists" },
      { status: 409 },
    );
  }
  await AuditEvent.create({
    accountId: session.user.id,
    spaceId: parsedSpaceId.data,
    productId,
    action: "key_handoff.created",
    metadata: { transactionId: body.transactionId, clientId: body.clientId },
  }).catch(() => undefined);
  return Response.json({ transactionId: body.transactionId, expiresAt }, { status: 201 });
}
