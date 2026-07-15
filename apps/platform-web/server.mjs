import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import next from "next";
import { Server } from "socket.io";
import {
  isRealtimeProduct,
  parseRealtimeEvent,
  productAccountRoom,
  productSpaceRoom,
  revokedAccessKey,
  revokedSessionKey,
  shouldDisconnectRealtimeSocket,
} from "./lib/realtime/server-events.mjs";

const dev = !process.argv.includes("--prod");
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const socketPath = "/api/socket.io";
const realtimeChannel = "xenode:sync:events";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const ticketMaxTtlSeconds = 60;

function requiredIndependentSecret(name) {
  const value = process.env[name];
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must be configured with at least 32 bytes`);
  }
  return value;
}

const ticketSecret = requiredIndependentSecret("REALTIME_TICKET_SECRET");
const cdnSigningSecret = requiredIndependentSecret("CDN_SIGNING_SECRET");
if (
  ticketSecret === cdnSigningSecret ||
  ticketSecret === process.env.BETTER_AUTH_SECRET ||
  cdnSigningSecret === process.env.BETTER_AUTH_SECRET
) {
  throw new Error(
    "REALTIME_TICKET_SECRET, CDN_SIGNING_SECRET, and BETTER_AUTH_SECRET must be distinct",
  );
}

const allowedOrigins = (process.env.REALTIME_ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.origin !== origin
    ) {
      throw new Error("REALTIME_ALLOWED_ORIGIN entries must be exact http(s) origins");
    }
    return parsed.origin;
  });
if (allowedOrigins.length === 0) {
  throw new Error("REALTIME_ALLOWED_ORIGIN must contain at least one product origin");
}

const ticketRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
ticketRedis.on("error", (error) => {
  console.warn("[realtime] Redis ticket-store error", error.message);
});

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

async function verifyAndConsumeTicket(token) {
  if (typeof token !== "string") return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;

  const expected = createHmac("sha256", ticketSecret)
    .update(body)
    .digest("base64url");
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (
      !nonEmpty(claims.ticketId) ||
      !nonEmpty(claims.accountId) ||
      !isRealtimeProduct(claims.productId) ||
      !nonEmpty(claims.spaceId) ||
      !nonEmpty(claims.sessionId) ||
      !Number.isInteger(claims.issuedAt) ||
      !Number.isInteger(claims.expiresAt) ||
      claims.expiresAt <= now ||
      claims.issuedAt > now + 5 ||
      claims.expiresAt <= claims.issuedAt ||
      claims.expiresAt - claims.issuedAt > ticketMaxTtlSeconds
    ) {
      return null;
    }

    const revoked = await ticketRedis.mget(
      revokedSessionKey(claims.sessionId),
      revokedAccessKey(
        claims.accountId,
        claims.productId,
        claims.spaceId,
      ),
    );
    if (revoked.some(Boolean)) return null;

    const ttl = Math.max(1, claims.expiresAt - now);
    const consumed = await ticketRedis.set(
      `realtime:ticket:${claims.ticketId}`,
      "1",
      "EX",
      ttl,
      "NX",
    );
    return consumed === "OK" ? claims : null;
  } catch {
    return null;
  }
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const httpServer = createServer((request, response) => {
  void handle(request, response);
});

const io = new Server(httpServer, {
  path: socketPath,
  transports: ["websocket", "polling"],
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

io.use(async (socket, nextMiddleware) => {
  try {
    const claims = await verifyAndConsumeTicket(socket.handshake.auth?.token);
    if (!claims) return nextMiddleware(new Error("Unauthorized"));
    socket.data.accountId = claims.accountId;
    socket.data.productId = claims.productId;
    socket.data.spaceId = claims.spaceId;
    socket.data.sessionId = claims.sessionId;
    nextMiddleware();
  } catch (error) {
    nextMiddleware(error instanceof Error ? error : new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  void socket.join([
    productSpaceRoom(socket.data.productId, socket.data.spaceId),
    productAccountRoom(socket.data.productId, socket.data.accountId),
  ]);
  socket.emit("sync:event", {
    id: `connect:${socket.id}:${Date.now()}`,
    type: "SYNC_REQUIRED",
    userId: socket.data.accountId,
    productId: socket.data.productId,
    spaceId: socket.data.spaceId,
    occurredAt: new Date().toISOString(),
    payload: { reason: "socket_connected" },
  });
});

const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
subscriber.on("error", (error) => {
  console.warn("[realtime] Redis subscriber error", error.message);
  io.disconnectSockets(true);
});
subscriber.on("end", () => {
  console.warn("[realtime] Redis subscriber disconnected; closing sockets");
  io.disconnectSockets(true);
});
await subscriber.subscribe(realtimeChannel);
subscriber.on("message", async (channel, rawEvent) => {
  if (channel !== realtimeChannel) return;
  try {
    const parsed = parseRealtimeEvent(rawEvent);
    if (!parsed) return;
    if (parsed.markerKey && parsed.markerTtl) {
      await ticketRedis.set(
        parsed.markerKey,
        "1",
        "EX",
        parsed.markerTtl,
      );
    }
    io.to(parsed.room).emit("sync:event", parsed.event);
    if (parsed.kind === "sync") return;

    const sockets = await io.in(parsed.room).fetchSockets();
    for (const socket of sockets) {
      if (shouldDisconnectRealtimeSocket(parsed, socket.data)) {
        socket.disconnect(true);
      }
    }
  } catch (error) {
    console.warn("[realtime] Dropped invalid event", error);
  }
});

httpServer.listen(port, hostname, () => {
  console.log(
    `[server] Next.js + Socket.IO listening on http://${hostname}:${port}${socketPath}`,
  );
});

async function shutdown(signal) {
  console.log(`[server] ${signal}; shutting down`);
  await new Promise((resolve) => io.close(resolve));
  ticketRedis.disconnect();
  subscriber.disconnect();
  httpServer.close(() => process.exit(0));
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
