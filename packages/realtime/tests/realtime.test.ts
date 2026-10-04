import { describe, expect, it, vi } from "vitest";
import {
  REALTIME_CONNECTION_MAX_SECONDS,
  createProductSessionRevokedEvent,
  issueRealtimeTicket,
  parseRealtimeAllowedOrigins,
  parseRealtimeEvent,
  realtimeAccountRoom,
  realtimeConnectionDeadline,
  realtimeRevokedAccessKey,
  realtimeRevokedSessionKey,
  realtimeRoom,
  realtimeTicketAuth,
  shouldDisconnectRealtimeSocket,
  verifyRealtimeTicket,
  type RealtimeTicketClaims,
} from "../src";

const secret = "r".repeat(48);
const origin = "https://photos.example.test";
const claims: RealtimeTicketClaims = {
  ticketId: "ticket_1",
  accountId: "acct_1",
  productId: "photos",
  spaceId: "space_1",
  sessionId: "session_1",
  origin,
  issuedAt: 100,
  expiresAt: 130,
  sessionExpiresAt: 3_600,
};

function replayStore() {
  const consumed = new Set<string>();
  return async (ticketId: string) => {
    if (consumed.has(ticketId)) return false;
    consumed.add(ticketId);
    return true;
  };
}

function verify(
  ticket: unknown,
  overrides: Partial<Parameters<typeof verifyRealtimeTicket>[1]> = {},
) {
  return verifyRealtimeTicket(ticket, {
    secret,
    origin,
    nowSeconds: 110,
    consume: replayStore(),
    ...overrides,
  });
}

describe("realtime tickets", () => {
  it("admits a ticket once, from its exact origin", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    const consume = replayStore();
    await expect(verify(ticket, { consume })).resolves.toEqual(claims);
    await expect(verify(ticket, { consume })).rejects.toMatchObject({
      code: "replayed",
    });
  });

  it("binds the ticket to the requesting page origin", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    for (const other of ["https://drive.example.test", null, undefined]) {
      await expect(verify(ticket, { origin: other })).rejects.toMatchObject({
        code: "origin",
      });
    }
    const native = await issueRealtimeTicket(
      { ...claims, ticketId: "native", origin: null },
      secret,
    );
    await expect(verify(native, { origin: null })).resolves.toMatchObject({
      origin: null,
    });
    await expect(
      verify(native, { origin: "https://photos.example.test" }),
    ).rejects.toMatchObject({ code: "origin" });
  });

  it("rejects expired tickets, expired sessions and future tickets", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    await expect(verify(ticket, { nowSeconds: 130 })).rejects.toMatchObject({
      code: "expired",
    });
    const ending = await issueRealtimeTicket(
      { ...claims, sessionExpiresAt: 105 },
      secret,
    );
    await expect(verify(ending)).rejects.toMatchObject({ code: "expired" });
    const future = await issueRealtimeTicket(
      { ...claims, issuedAt: 200, expiresAt: 230 },
      secret,
    );
    await expect(verify(future)).rejects.toMatchObject({ code: "expired" });
  });

  it("rejects tampering and malformed tickets before any store access", async () => {
    const consume = vi.fn(async () => true);
    const ticket = await issueRealtimeTicket(claims, secret);
    const [payload, signature] = ticket.split(".");
    for (const candidate of [
      `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`,
      `${payload}.${signature}.extra`,
      `${payload}.${signature}.`,
      "not-a-ticket",
      42,
    ]) {
      await expect(verify(candidate, { consume })).rejects.toThrow(
        "Realtime ticket rejected",
      );
    }
    const otherSecret = await issueRealtimeTicket(claims, "s".repeat(48));
    await expect(verify(otherSecret, { consume })).rejects.toMatchObject({
      code: "signature",
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("refuses invalid claims and weak secrets at issuance", async () => {
    for (const invalid of [
      { ...claims, expiresAt: 161 },
      { ...claims, sessionExpiresAt: 100 },
      { ...claims, origin: "https://photos.example.test/path" },
      { ...claims, origin: "*" },
      { ...claims, productId: "accounts" },
    ]) {
      await expect(
        issueRealtimeTicket(invalid as RealtimeTicketClaims, secret),
      ).rejects.toThrow("invalid");
    }
    await expect(issueRealtimeTicket(claims, "weak")).rejects.toThrow("32");
  });

  it("fails closed on revocation markers and store failures", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    await expect(
      verify(ticket, { isRevoked: async () => true }),
    ).rejects.toMatchObject({ code: "revoked" });
    await expect(
      verify(ticket, {
        consume: async () => {
          throw new Error("redis unavailable");
        },
      }),
    ).rejects.toThrow("redis unavailable");
  });

  it("bounds a connection by its session and the reauthorization interval", () => {
    expect(realtimeConnectionDeadline({ sessionExpiresAt: 500 }, 400)).toBe(500);
    expect(realtimeConnectionDeadline({ sessionExpiresAt: 1_000_000 }, 400)).toBe(
      400 + REALTIME_CONNECTION_MAX_SECONDS,
    );
  });

  it("requires exact allowed origins", () => {
    expect(
      parseRealtimeAllowedOrigins("https://a.example.test, http://localhost:3002"),
    ).toEqual(["https://a.example.test", "http://localhost:3002"]);
    for (const bad of ["", "https://a.example.test/", "*", "ftp://a.example.test"]) {
      expect(() => parseRealtimeAllowedOrigins(bad)).toThrow("REALTIME_ALLOWED_ORIGIN");
    }
  });

  it("fetches a fresh ticket for every connection attempt", async () => {
    let issued = 0;
    const auth = realtimeTicketAuth(async () => `ticket-${(issued += 1)}`);
    const tokens = await Promise.all(
      [1, 2].map(
        () => new Promise((resolve) => auth((value) => resolve(value.token))),
      ),
    );
    expect(tokens).toEqual(["ticket-1", "ticket-2"]);
    const failing = realtimeTicketAuth(async () => {
      throw new Error("401");
    });
    await expect(
      new Promise((resolve) => failing(resolve)),
    ).resolves.toEqual({});
  });
});

describe("realtime events and rooms", () => {
  it("uses product-scoped data and account control rooms", () => {
    expect(realtimeRoom("drive", "space_1")).toBe("product:drive:space:space_1");
    expect(realtimeAccountRoom("photos", "acct_1")).toBe(
      "product:photos:account:acct_1",
    );
    expect(realtimeRevokedSessionKey("session_1")).toBe(
      "realtime:revoked-session:session_1",
    );
    expect(realtimeRevokedAccessKey("acct_1", "photos", "space_1")).toBe(
      "realtime:revoked-access:acct_1:photos:space_1",
    );
    expect(
      createProductSessionRevokedEvent({
        eventId: "event_1",
        accountId: "acct_1",
        productId: "photos",
        sessionId: "session_1",
        sessionExpiresAt: new Date("2026-07-16T00:00:00.000Z"),
        occurredAt: new Date("2026-07-15T23:00:00.000Z"),
      }),
    ).toEqual({
      id: "event_1",
      type: "SESSION_REVOKED",
      userId: "acct_1",
      productId: "photos",
      sessionId: "session_1",
      expiresAt: "2026-07-16T00:00:00.000Z",
      occurredAt: "2026-07-15T23:00:00.000Z",
    });
  });

  it("disconnects only the revoked session or Space access", () => {
    const session = parseRealtimeEvent(
      {
        id: "event_1",
        type: "SESSION_REVOKED",
        userId: "acct_1",
        productId: "photos",
        sessionId: "session_1",
        expiresAt: "2026-07-16T00:00:00.000Z",
        occurredAt: "2026-07-15T23:00:00.000Z",
      },
      new Date("2026-07-15T23:30:00.000Z").getTime(),
    );
    expect(session).toMatchObject({
      kind: "session-revoked",
      room: "product:photos:account:acct_1",
      markerKey: "realtime:revoked-session:session_1",
    });
    expect(
      shouldDisconnectRealtimeSocket(session!, {
        accountId: "acct_1",
        productId: "photos",
        sessionId: "session_1",
      }),
    ).toBe(true);
    expect(
      shouldDisconnectRealtimeSocket(session!, {
        accountId: "acct_1",
        productId: "photos",
        sessionId: "session_2",
      }),
    ).toBe(false);

    const access = parseRealtimeEvent({
      id: "event_2",
      type: "ACCESS_REVOKED",
      userId: "acct_1",
      productId: "drive",
      spaceId: "space_1",
      occurredAt: "2026-07-15T23:00:00.000Z",
      payload: { reason: "member_removed" },
    });
    expect(access).toMatchObject({
      kind: "access-revoked",
      room: "product:drive:space:space_1",
      markerKey: "realtime:revoked-access:acct_1:drive:space_1",
      markerTtl: 60,
    });
    expect(
      shouldDisconnectRealtimeSocket(access!, {
        accountId: "acct_1",
        productId: "photos",
        spaceId: "space_1",
      }),
    ).toBe(false);
    expect(parseRealtimeEvent("{invalid")).toBeNull();
    expect(parseRealtimeEvent({ type: "SESSION_REVOKED" })).toBeNull();
  });
});
