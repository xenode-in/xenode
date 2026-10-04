import { Server } from "socket.io";
import {
  parseRealtimeEvent,
  realtimeAccountRoom,
  realtimeConnectionDeadline,
  realtimeRoom,
  shouldDisconnectRealtimeSocket,
  verifyRealtimeTicket,
} from "@xenode/realtime/protocol";

export const REALTIME_SOCKET_PATH = "/api/socket.io";

/**
 * Attach the realtime Socket.IO server to an HTTP server.
 *
 * - WebSocket transport only. Socket.IO's CORS settings apply to HTTP
 *   long-polling; browsers do not enforce CORS on WebSockets, so the Engine.IO
 *   handshake itself rejects any Origin outside the exact allowlist.
 * - Every connection presents a one-use ticket bound to its page origin (or to
 *   no origin for credentialed native clients) and to its ProductSession expiry.
 * - A socket is disconnected at its session expiry, and at least every
 *   REALTIME_CONNECTION_MAX_SECONDS, so clients re-authorize with a new ticket.
 *
 * `store.consume` and `store.isRevoked` must reject (not hang) when their
 * backing store is unavailable; the handshake then fails closed.
 */
export function attachRealtimeServer(httpServer, options) {
  const allowedOrigins = new Set(options.allowedOrigins);
  const now = options.now ?? (() => Date.now());
  const io = new Server(httpServer, {
    path: REALTIME_SOCKET_PATH,
    transports: ["websocket"],
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    cors: { origin: [...allowedOrigins], credentials: false },
  });

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      const claims = await verifyRealtimeTicket(socket.handshake.auth?.token, {
        secret: options.secret,
        origin: origin ?? null,
        nowSeconds: Math.floor(now() / 1000),
        consume: options.store.consume,
        isRevoked: options.store.isRevoked,
      });
      socket.data.accountId = claims.accountId;
      socket.data.productId = claims.productId;
      socket.data.spaceId = claims.spaceId;
      socket.data.sessionId = claims.sessionId;
      socket.data.deadline = realtimeConnectionDeadline(
        claims,
        Math.floor(now() / 1000),
      );
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.deadline * 1000 - now()),
    );
    timer.unref?.();
    socket.on("disconnect", () => clearTimeout(timer));
    void socket.join([
      realtimeRoom(socket.data.productId, socket.data.spaceId),
      realtimeAccountRoom(socket.data.productId, socket.data.accountId),
    ]);
    socket.emit("sync:event", {
      id: `connect:${socket.id}:${now()}`,
      type: "SYNC_REQUIRED",
      userId: socket.data.accountId,
      productId: socket.data.productId,
      spaceId: socket.data.spaceId,
      occurredAt: new Date(now()).toISOString(),
      payload: { reason: "socket_connected" },
    });
  });

  /**
   * Deliver one published event. Revocation markers are written before
   * fan-out so a racing handshake with an older ticket is refused.
   */
  async function deliver(rawEvent, setMarker) {
    const parsed = parseRealtimeEvent(rawEvent, now());
    if (!parsed) return false;
    if (parsed.markerKey && parsed.markerTtl) {
      await setMarker(parsed.markerKey, parsed.markerTtl);
    }
    io.to(parsed.room).emit("sync:event", parsed.event);
    if (parsed.kind === "sync") return true;
    for (const socket of await io.in(parsed.room).fetchSockets()) {
      if (shouldDisconnectRealtimeSocket(parsed, socket.data)) {
        socket.disconnect(true);
      }
    }
    return true;
  }

  return { io, deliver };
}
