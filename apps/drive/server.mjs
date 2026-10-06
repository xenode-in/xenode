import { createServer } from "node:http";
import Redis from "ioredis";
import next from "next";
import {
  REALTIME_CHANNEL,
  parseRealtimeAllowedOrigins,
  realtimeRevokedAccessKey,
  realtimeRevokedSessionKey,
} from "@xenode/realtime/protocol";
import {
  REALTIME_SOCKET_PATH,
  attachRealtimeServer,
} from "./lib/realtime/socket-server.mjs";

const dev = !process.argv.includes("--prod");
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

function requiredIndependentSecret(name) {
  const value = process.env[name];
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must be configured with at least 32 bytes`);
  }
  return value;
}

const ticketSecret = requiredIndependentSecret("REALTIME_TICKET_SECRET");
if (ticketSecret === process.env.BETTER_AUTH_SECRET) throw new Error("REALTIME_TICKET_SECRET must be independent");

const allowedOrigins = parseRealtimeAllowedOrigins(
  process.env.REALTIME_ALLOWED_ORIGIN,
);

// Ticket checks must fail fast: no offline queue and a command timeout, so an
// unavailable Redis rejects the handshake instead of holding it open.
const ticketRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 2_000,
});
ticketRedis.on("error", (error) => {
  console.warn("[realtime] Redis ticket-store error", error.message);
});

const ticketStore = {
  async consume(ticketId, ttlSeconds) {
    const consumed = await ticketRedis.set(
      `realtime:ticket:${ticketId}`,
      "1",
      "EX",
      ttlSeconds,
      "NX",
    );
    return consumed === "OK";
  },
  async isRevoked(claims) {
    const markers = await ticketRedis.mget(
      realtimeRevokedSessionKey(claims.sessionId),
      realtimeRevokedAccessKey(claims.accountId, claims.productId, claims.spaceId),
    );
    return markers.some(Boolean);
  },
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const httpServer = createServer((request, response) => {
  void handle(request, response);
});

const realtime = attachRealtimeServer(httpServer, {
  allowedOrigins,
  secret: ticketSecret,
  store: ticketStore,
});

const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
// Without the event stream, revocations cannot reach sockets: drop them all.
subscriber.on("error", (error) => {
  console.warn("[realtime] Redis subscriber error", error.message);
  realtime.io.disconnectSockets(true);
});
subscriber.on("end", () => {
  console.warn("[realtime] Redis subscriber disconnected; closing sockets");
  realtime.io.disconnectSockets(true);
});
await subscriber.subscribe(REALTIME_CHANNEL);
subscriber.on("message", async (channel, rawEvent) => {
  if (channel !== REALTIME_CHANNEL) return;
  try {
    await realtime.deliver(rawEvent, (key, ttlSeconds) =>
      ticketRedis.set(key, "1", "EX", ttlSeconds),
    );
  } catch (error) {
    console.warn("[realtime] Dropped invalid event", error);
  }
});

httpServer.listen(port, hostname, () => {
  console.log(
    `[server] Next.js + Socket.IO listening on http://${hostname}:${port}${REALTIME_SOCKET_PATH}`,
  );
});

async function shutdown(signal) {
  console.log(`[server] ${signal}; shutting down`);
  await new Promise((resolve) => realtime.io.close(resolve));
  ticketRedis.disconnect();
  subscriber.disconnect();
  httpServer.close(() => process.exit(0));
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
