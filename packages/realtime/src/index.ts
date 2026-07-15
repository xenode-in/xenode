export interface RealtimeTicketClaims {
  ticketId: string;
  accountId: string;
  productId: string;
  spaceId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface TicketReplayStore {
  consume(ticketId: string, expiresAt: number): Promise<boolean>;
}

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, payload: string): Promise<string> {
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error("REALTIME_TICKET_SECRET must be at least 32 bytes");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
      ),
    ),
  );
}

export async function issueRealtimeTicket(
  claims: RealtimeTicketClaims,
  secret: string,
): Promise<string> {
  if (claims.expiresAt <= claims.issuedAt || claims.expiresAt - claims.issuedAt > 60) {
    throw new Error("Realtime tickets must expire within 60 seconds");
  }
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyAndConsumeRealtimeTicket(
  ticket: string,
  expected: Pick<
    RealtimeTicketClaims,
    "productId" | "spaceId" | "sessionId"
  >,
  secret: string,
  replayStore: TicketReplayStore,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RealtimeTicketClaims> {
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra) throw new Error("Invalid realtime ticket");
  const expectedSignature = await hmac(secret, payload);
  if (signature !== expectedSignature) throw new Error("Invalid realtime ticket");
  const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as RealtimeTicketClaims;
  if (
    claims.expiresAt <= nowSeconds ||
    claims.issuedAt > nowSeconds + 5 ||
    claims.productId !== expected.productId ||
    claims.spaceId !== expected.spaceId ||
    claims.sessionId !== expected.sessionId
  ) {
    throw new Error("Realtime ticket binding or expiry mismatch");
  }
  if (!(await replayStore.consume(claims.ticketId, claims.expiresAt))) {
    throw new Error("Realtime ticket already consumed");
  }
  return claims;
}

export function realtimeRoom(productId: string, spaceId: string): string {
  return `product:${productId}:space:${spaceId}`;
}
