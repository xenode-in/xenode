import type { ProductSlug } from "@xenode/contracts";

export const REALTIME_CHANNEL = "xenode:sync:events";
export const REALTIME_TICKET_MAX_TTL_SECONDS = 60;

export interface RealtimeTicketClaims {
  ticketId: string;
  accountId: string;
  productId: ProductSlug;
  spaceId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface ProductSessionRevokedEvent {
  id: string;
  type: "SESSION_REVOKED";
  userId: string;
  productId: ProductSlug;
  sessionId: string;
  expiresAt: string;
  occurredAt: string;
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

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validClaims(value: unknown): value is RealtimeTicketClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<RealtimeTicketClaims>;
  return (
    nonEmpty(claims.ticketId) &&
    nonEmpty(claims.accountId) &&
    nonEmpty(claims.productId) &&
    nonEmpty(claims.spaceId) &&
    nonEmpty(claims.sessionId) &&
    Number.isInteger(claims.issuedAt) &&
    Number.isInteger(claims.expiresAt) &&
    Number(claims.expiresAt) > Number(claims.issuedAt) &&
    Number(claims.expiresAt) - Number(claims.issuedAt) <=
      REALTIME_TICKET_MAX_TTL_SECONDS
  );
}

export async function issueRealtimeTicket(
  claims: RealtimeTicketClaims,
  secret: string,
): Promise<string> {
  if (!validClaims(claims)) {
    throw new Error("Realtime ticket claims are invalid or exceed 60 seconds");
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
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error("Invalid realtime ticket");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decode(payload)));
  } catch {
    throw new Error("Invalid realtime ticket");
  }
  if (!validClaims(parsed)) throw new Error("Invalid realtime ticket");
  const claims = parsed;
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

export function realtimeRoom(productId: ProductSlug, spaceId: string): string {
  return `product:${productId}:space:${spaceId}`;
}

export function realtimeAccountRoom(
  productId: ProductSlug,
  accountId: string,
): string {
  return `product:${productId}:account:${accountId}`;
}

export function realtimeRevokedSessionKey(sessionId: string): string {
  return `realtime:revoked-session:${sessionId}`;
}

export function realtimeRevokedAccessKey(
  accountId: string,
  productId: ProductSlug,
  spaceId: string,
): string {
  return `realtime:revoked-access:${accountId}:${productId}:${spaceId}`;
}

export function createProductSessionRevokedEvent(args: {
  eventId: string;
  accountId: string;
  productId: ProductSlug;
  sessionId: string;
  sessionExpiresAt: Date;
  occurredAt?: Date;
}): ProductSessionRevokedEvent {
  return {
    id: args.eventId,
    type: "SESSION_REVOKED",
    userId: args.accountId,
    productId: args.productId,
    sessionId: args.sessionId,
    expiresAt: args.sessionExpiresAt.toISOString(),
    occurredAt: (args.occurredAt ?? new Date()).toISOString(),
  };
}
