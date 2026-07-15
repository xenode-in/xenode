const TICKET_MAX_TTL_SECONDS = 60;
const realtimeProducts = new Set([
  "drive",
  "photos",
  "mobile",
  "office-editor",
]);

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

export function isRealtimeProduct(value) {
  return realtimeProducts.has(value);
}

export function revokedSessionKey(sessionId) {
  return `realtime:revoked-session:${sessionId}`;
}

export function revokedAccessKey(accountId, productId, spaceId) {
  return `realtime:revoked-access:${accountId}:${productId}:${spaceId}`;
}

export function productSpaceRoom(productId, spaceId) {
  return `product:${productId}:space:${spaceId}`;
}

export function productAccountRoom(productId, accountId) {
  return `product:${productId}:account:${accountId}`;
}

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
      !nonEmpty(event.occurredAt) ||
      !Number.isFinite(new Date(event.occurredAt).getTime())
    ) {
      return null;
    }
    return {
      kind: "session-revoked",
      event,
      room: productAccountRoom(event.productId, event.userId),
      markerKey: revokedSessionKey(event.sessionId),
      markerTtl: Math.max(
        TICKET_MAX_TTL_SECONDS,
        Math.min(
          7 * 24 * 60 * 60,
          Math.ceil((expiry - nowMs) / 1000),
        ),
      ),
    };
  }

  if (
    !nonEmpty(event.id) ||
    !nonEmpty(event.type) ||
    !nonEmpty(event.userId) ||
    !isRealtimeProduct(event.productId) ||
    !nonEmpty(event.spaceId) ||
    !nonEmpty(event.occurredAt) ||
    !Number.isFinite(new Date(event.occurredAt).getTime()) ||
    !event.payload ||
    typeof event.payload !== "object"
  ) {
    return null;
  }
  const accessRevoked = event.type === "ACCESS_REVOKED";
  return {
    kind: accessRevoked ? "access-revoked" : "sync",
    event,
    room: productSpaceRoom(event.productId, event.spaceId),
    markerKey: accessRevoked
      ? revokedAccessKey(event.userId, event.productId, event.spaceId)
      : null,
    markerTtl: accessRevoked ? TICKET_MAX_TTL_SECONDS : null,
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
