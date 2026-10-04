// Realtime protocol shared by the product ticket issuers (Next.js), the Drive
// Socket.IO server (plain Node ESM) and browser clients. Plain JavaScript with
// types in protocol.d.mts so the custom server imports it without a build step.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const REALTIME_CHANNEL = "xenode:sync:events";
export const REALTIME_TICKET_MAX_TTL_SECONDS = 60;
/** Connected sockets re-authorize with a fresh ticket at least this often. */
export const REALTIME_CONNECTION_MAX_SECONDS = 15 * 60;
export const REALTIME_PRODUCTS = Object.freeze([
  "drive",
  "photos",
  "mobile",
  "office-editor",
]);

const products = new Set(REALTIME_PRODUCTS);

export function isRealtimeProduct(value) {
  return products.has(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

/** The exact http(s) origin, or null for anything else (paths, wildcards). */
export function exactRealtimeOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === value
      ? value
      : null;
  } catch {
    return null;
  }
}

export function parseRealtimeAllowedOrigins(value) {
  const origins = String(value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    if (exactRealtimeOrigin(origin) !== origin) {
      throw new Error("REALTIME_ALLOWED_ORIGIN entries must be exact http(s) origins");
    }
  }
  if (origins.length === 0) {
    throw new Error("REALTIME_ALLOWED_ORIGIN must contain at least one product origin");
  }
  return origins;
}

function base64Url(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret, payload) {
  if (typeof secret !== "string" || encoder.encode(secret).length < 32) {
    throw new Error("REALTIME_TICKET_SECRET must be at least 32 bytes");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))),
  );
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function validRealtimeTicketClaims(value) {
  if (!value || typeof value !== "object") return false;
  const claims = value;
  return (
    nonEmpty(claims.ticketId) &&
    nonEmpty(claims.accountId) &&
    isRealtimeProduct(claims.productId) &&
    nonEmpty(claims.spaceId) &&
    nonEmpty(claims.sessionId) &&
    (claims.origin === null || exactRealtimeOrigin(claims.origin) === claims.origin) &&
    Number.isSafeInteger(claims.issuedAt) &&
    Number.isSafeInteger(claims.expiresAt) &&
    Number.isSafeInteger(claims.sessionExpiresAt) &&
    claims.expiresAt > claims.issuedAt &&
    claims.expiresAt - claims.issuedAt <= REALTIME_TICKET_MAX_TTL_SECONDS &&
    claims.sessionExpiresAt > claims.issuedAt
  );
}

/**
 * Sign a one-use ticket. `origin` is the exact page origin that requested it
 * (null only for credentialed non-browser clients); `sessionExpiresAt` is the
 * ProductSession expiry, which bounds the socket's lifetime.
 */
export async function issueRealtimeTicket(claims, secret) {
  if (!validRealtimeTicketClaims(claims)) {
    throw new Error("Realtime ticket claims are invalid or exceed 60 seconds");
  }
  const canonical = {
    ticketId: claims.ticketId,
    accountId: claims.accountId,
    productId: claims.productId,
    spaceId: claims.spaceId,
    sessionId: claims.sessionId,
    origin: claims.origin,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    sessionExpiresAt: claims.sessionExpiresAt,
  };
  const payload = base64Url(encoder.encode(JSON.stringify(canonical)));
  return `${payload}.${await hmac(secret, payload)}`;
}

export class RealtimeTicketError extends Error {
  constructor(code) {
    super(`Realtime ticket rejected: ${code}`);
    this.name = "RealtimeTicketError";
    this.code = code;
  }
}

/**
 * Verify a ticket at the socket handshake: signature, claim shape, lifetime,
 * exact origin binding, revocation markers and one-time consumption, in that
 * order. Store failures propagate, so a handshake fails closed.
 */
export async function verifyRealtimeTicket(ticket, options) {
  if (typeof ticket !== "string" || ticket.split(".").length !== 2) {
    throw new RealtimeTicketError("malformed");
  }
  const [payload, signature] = ticket.split(".");
  if (!constantTimeEqual(signature, await hmac(options.secret, payload))) {
    throw new RealtimeTicketError("signature");
  }
  let claims;
  try {
    claims = JSON.parse(decoder.decode(decodeBase64Url(payload)));
  } catch {
    throw new RealtimeTicketError("malformed");
  }
  if (!validRealtimeTicketClaims(claims)) throw new RealtimeTicketError("claims");
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    claims.expiresAt <= now ||
    claims.issuedAt > now + 5 ||
    claims.sessionExpiresAt <= now
  ) {
    throw new RealtimeTicketError("expired");
  }
  if (claims.origin !== (options.origin ?? null)) {
    throw new RealtimeTicketError("origin");
  }
  if (options.isRevoked && (await options.isRevoked(claims))) {
    throw new RealtimeTicketError("revoked");
  }
  if (!(await options.consume(claims.ticketId, Math.max(1, claims.expiresAt - now)))) {
    throw new RealtimeTicketError("replayed");
  }
  return claims;
}

/** Unix second at which a socket admitted at `connectedAt` must disconnect. */
export function realtimeConnectionDeadline(claims, connectedAt) {
  return Math.min(claims.sessionExpiresAt, connectedAt + REALTIME_CONNECTION_MAX_SECONDS);
}

/**
 * Socket.IO `auth` callback that fetches a fresh one-use ticket for every
 * connection attempt, including automatic reconnects.
 */
export function realtimeTicketAuth(fetchTicket) {
  return (callback) => {
    Promise.resolve()
      .then(fetchTicket)
      .then(
        (token) => callback(typeof token === "string" ? { token } : {}),
        () => callback({}),
      );
  };
}

export function realtimeRoom(productId, spaceId) {
  return `product:${productId}:space:${spaceId}`;
}

export function realtimeAccountRoom(productId, accountId) {
  return `product:${productId}:account:${accountId}`;
}

export function realtimeRevokedSessionKey(sessionId) {
  return `realtime:revoked-session:${sessionId}`;
}

export function realtimeRevokedAccessKey(accountId, productId, spaceId) {
  return `realtime:revoked-access:${accountId}:${productId}:${spaceId}`;
}

export function createProductSessionRevokedEvent(args) {
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

function validTime(value) {
  return nonEmpty(value) && Number.isFinite(new Date(value).getTime());
}

/** Validate a published event and decide its room and revocation marker. */
export function parseRealtimeEvent(rawEvent, nowMs = Date.now()) {
  let event;
  try {
    event = typeof rawEvent === "string" ? JSON.parse(rawEvent) : rawEvent;
  } catch {
    return null;
  }
  if (!event || typeof event !== "object") return null;

  if (event.type === "SESSION_REVOKED") {
    const expiry = new Date(event.expiresAt).getTime();
    if (
      !nonEmpty(event.id) ||
      !nonEmpty(event.userId) ||
      !isRealtimeProduct(event.productId) ||
      !nonEmpty(event.sessionId) ||
      !Number.isFinite(expiry) ||
      !validTime(event.occurredAt)
    ) {
      return null;
    }
    return {
      kind: "session-revoked",
      event,
      room: realtimeAccountRoom(event.productId, event.userId),
      markerKey: realtimeRevokedSessionKey(event.sessionId),
      markerTtl: Math.max(
        REALTIME_TICKET_MAX_TTL_SECONDS,
        Math.min(7 * 24 * 60 * 60, Math.ceil((expiry - nowMs) / 1000)),
      ),
    };
  }

  if (
    !nonEmpty(event.id) ||
    !nonEmpty(event.type) ||
    !nonEmpty(event.userId) ||
    !isRealtimeProduct(event.productId) ||
    !nonEmpty(event.spaceId) ||
    !validTime(event.occurredAt) ||
    !event.payload ||
    typeof event.payload !== "object"
  ) {
    return null;
  }
  const accessRevoked = event.type === "ACCESS_REVOKED";
  return {
    kind: accessRevoked ? "access-revoked" : "sync",
    event,
    room: realtimeRoom(event.productId, event.spaceId),
    markerKey: accessRevoked
      ? realtimeRevokedAccessKey(event.userId, event.productId, event.spaceId)
      : null,
    markerTtl: accessRevoked ? REALTIME_TICKET_MAX_TTL_SECONDS : null,
  };
}

export function shouldDisconnectRealtimeSocket(parsed, socketData) {
  if (parsed.kind === "session-revoked") {
    return (
      socketData.accountId === parsed.event.userId &&
      socketData.productId === parsed.event.productId &&
      socketData.sessionId === parsed.event.sessionId
    );
  }
  if (parsed.kind === "access-revoked") {
    return (
      socketData.accountId === parsed.event.userId &&
      socketData.productId === parsed.event.productId &&
      socketData.spaceId === parsed.event.spaceId
    );
  }
  return false;
}
