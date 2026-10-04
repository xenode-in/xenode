import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import {
  issueRealtimeTicket,
  realtimeTicketAuth,
  type RealtimeTicketClaims,
} from "@xenode/realtime";
import { attachRealtimeServer } from "@/lib/realtime/socket-server.mjs";

// A real HTTP + Socket.IO server and Node client exercise the handshake gate.
const secret = "r".repeat(48);
const driveOrigin = "https://drive.example.test";
const photosOrigin = "https://photos.example.test";

let http: HttpServer;
let realtime: ReturnType<typeof attachRealtimeServer>;
let url: string;
let consumed: Set<string>;
let storeFailure: Error | null;
let revoked: boolean;
const sockets: Socket[] = [];
const consume = vi.fn(async (ticketId: string) => {
  if (storeFailure) throw storeFailure;
  if (consumed.has(ticketId)) return false;
  consumed.add(ticketId);
  return true;
});

beforeEach(async () => {
  consumed = new Set();
  storeFailure = null;
  revoked = false;
  consume.mockClear();
  http = createServer();
  realtime = attachRealtimeServer(http, {
    allowedOrigins: [driveOrigin, photosOrigin],
    secret,
    store: { consume, isRevoked: async () => revoked },
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await new Promise<void>((resolve) => realtime.io.close(() => resolve()));
});

function ticket(overrides: Partial<RealtimeTicketClaims> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return issueRealtimeTicket(
    {
      ticketId: randomUUID(),
      accountId: "acct_1",
      productId: "drive",
      spaceId: "space_1",
      sessionId: "session_1",
      origin: driveOrigin,
      issuedAt: now,
      expiresAt: now + 60,
      sessionExpiresAt: now + 3_600,
      ...overrides,
    },
    secret,
  );
}

function open(options: {
  origin?: string;
  token?: string;
  auth?: ReturnType<typeof realtimeTicketAuth>;
  transports?: string[];
}) {
  const socket = connect(url, {
    path: "/api/socket.io",
    transports: options.transports ?? ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: options.auth ?? { token: options.token },
    extraHeaders: options.origin ? { origin: options.origin } : {},
  });
  sockets.push(socket);
  return socket;
}

function outcome(socket: Socket) {
  return new Promise<string>((resolve) => {
    socket.once("connect", () => resolve("connected"));
    socket.once("connect_error", (error) => resolve(error.message));
  });
}

describe("realtime socket handshake", () => {
  it("admits a fresh ticket from its allowed origin and prompts a sync", async () => {
    const socket = open({ origin: driveOrigin, token: await ticket() });
    const prompt = new Promise((resolve) => socket.once("sync:event", resolve));
    expect(await outcome(socket)).toBe("connected");
    expect(await prompt).toMatchObject({
      type: "SYNC_REQUIRED",
      productId: "drive",
      spaceId: "space_1",
    });
  });

  it("rejects a hostile Origin before the ticket is examined", async () => {
    // Even a validly signed ticket bound to that origin must not get through:
    // the exact allowlist, not CORS, gates browser WebSocket handshakes.
    const hostile = "https://evil.example.test";
    const socket = open({ origin: hostile, token: await ticket({ origin: hostile }) });
    expect(await outcome(socket)).not.toBe("connected");
    expect(consume).not.toHaveBeenCalled();
  });

  it("refuses replay and reuse of a ticket from another allowed origin", async () => {
    const token = await ticket();
    expect(await outcome(open({ origin: photosOrigin, token }))).toBe("Unauthorized");
    expect(await outcome(open({ origin: driveOrigin, token }))).toBe("connected");
    expect(await outcome(open({ origin: driveOrigin, token }))).toBe("Unauthorized");
  });

  it("admits origin-less clients only with native tickets", async () => {
    expect(await outcome(open({ token: await ticket({ origin: null }) }))).toBe(
      "connected",
    );
    expect(await outcome(open({ token: await ticket() }))).toBe("Unauthorized");
  });

  it("does not offer HTTP long-polling", async () => {
    const socket = open({
      origin: driveOrigin,
      token: await ticket(),
      transports: ["polling"],
    });
    expect(await outcome(socket)).not.toBe("connected");
  });

  it("fails closed when the ticket store is unavailable or the session is revoked", async () => {
    storeFailure = new Error("redis unavailable");
    expect(await outcome(open({ origin: driveOrigin, token: await ticket() }))).toBe(
      "Unauthorized",
    );
    storeFailure = null;
    revoked = true;
    expect(await outcome(open({ origin: driveOrigin, token: await ticket() }))).toBe(
      "Unauthorized",
    );
  });

  it("disconnects when the ProductSession expires", async () => {
    const now = Math.floor(Date.now() / 1000);
    const socket = open({
      origin: driveOrigin,
      token: await ticket({ sessionExpiresAt: now + 2 }),
    });
    const closed = new Promise((resolve) => socket.once("disconnect", resolve));
    expect(await outcome(socket)).toBe("connected");
    expect(await closed).toBe("io server disconnect");
  });

  it("drops revoked sessions after marking them", async () => {
    const socket = open({ origin: driveOrigin, token: await ticket() });
    expect(await outcome(socket)).toBe("connected");
    const closed = new Promise((resolve) => socket.once("disconnect", resolve));
    const setMarker = vi.fn(async () => "OK");
    await realtime.deliver(
      JSON.stringify({
        id: "event_1",
        type: "SESSION_REVOKED",
        userId: "acct_1",
        productId: "drive",
        sessionId: "session_1",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        occurredAt: new Date().toISOString(),
      }),
      setMarker,
    );
    expect(setMarker).toHaveBeenCalledWith(
      "realtime:revoked-session:session_1",
      expect.any(Number),
    );
    expect(await closed).toBe("io server disconnect");
  });

  it("spends a new ticket on every connection attempt", async () => {
    let issued = 0;
    const socket = open({
      origin: driveOrigin,
      auth: realtimeTicketAuth(async () => {
        issued += 1;
        return ticket();
      }),
    });
    expect(await outcome(socket)).toBe("connected");
    const closed = new Promise((resolve) => socket.once("disconnect", resolve));
    realtime.io.disconnectSockets(true);
    await closed;
    socket.connect();
    expect(await outcome(socket)).toBe("connected");
    expect(issued).toBe(2);
    expect(consume).toHaveBeenCalledTimes(2);
  });
});
