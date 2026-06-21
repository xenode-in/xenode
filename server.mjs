import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import next from "next";
import { Server } from "socket.io";

const dev = !process.argv.includes("--prod");
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const socketPath = "/api/socket.io";
const realtimeChannel = "xenode:sync:events";

function verifyToken(token) {
  if (typeof token !== "string") return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const secret =
    process.env.REALTIME_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Realtime token secret is not configured");

  const expected = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof payload.sub !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload.sub;
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
    origin: process.env.REALTIME_ALLOWED_ORIGIN?.split(",") || true,
    credentials: true,
  },
});

io.use((socket, nextMiddleware) => {
  try {
    const userId = verifyToken(socket.handshake.auth?.token);
    if (!userId) return nextMiddleware(new Error("Unauthorized"));
    socket.data.userId = userId;
    nextMiddleware();
  } catch (error) {
    nextMiddleware(error instanceof Error ? error : new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  void socket.join(`user:${socket.data.userId}`);
  socket.emit("sync:event", {
    id: `connect:${socket.id}:${Date.now()}`,
    type: "SYNC_REQUIRED",
    userId: socket.data.userId,
    occurredAt: new Date().toISOString(),
    payload: { reason: "socket_connected" },
  });
});

const subscriber = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);
subscriber.on("error", (error) => {
  console.warn("[realtime] Redis subscriber error", error.message);
});
await subscriber.subscribe(realtimeChannel);
subscriber.on("message", (channel, rawEvent) => {
  if (channel !== realtimeChannel) return;
  try {
    const event = JSON.parse(rawEvent);
    if (typeof event.userId !== "string") return;
    io.to(`user:${event.userId}`).emit("sync:event", event);
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
  subscriber.disconnect();
  httpServer.close(() => process.exit(0));
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
