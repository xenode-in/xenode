import { describe, expect, it } from "vitest";
import {
  createProductSessionRevokedEvent,
  issueRealtimeTicket,
  realtimeAccountRoom,
  realtimeRevokedAccessKey,
  realtimeRevokedSessionKey,
  realtimeRoom,
  verifyAndConsumeRealtimeTicket,
  type TicketReplayStore,
} from "../src";

function store(): TicketReplayStore {
  const consumed = new Set<string>();
  return {
    async consume(id) {
      if (consumed.has(id)) return false;
      consumed.add(id);
      return true;
    },
  };
}

const secret = "r".repeat(48);
const claims = {
  ticketId: "ticket_1",
  accountId: "acct_1",
  productId: "photos" as const,
  spaceId: "space_1",
  sessionId: "session_1",
  issuedAt: 100,
  expiresAt: 130,
};

describe("realtime tickets v2", () => {
  it("is one-time and product+Space+session bound", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    const replay = store();
    await expect(
      verifyAndConsumeRealtimeTicket(
        ticket,
        {
          productId: "photos",
          spaceId: "space_1",
          sessionId: "session_1",
        },
        secret,
        replay,
        110,
      ),
    ).resolves.toMatchObject(claims);
    await expect(
      verifyAndConsumeRealtimeTicket(
        ticket,
        {
          productId: "photos",
          spaceId: "space_1",
          sessionId: "session_1",
        },
        secret,
        replay,
        110,
      ),
    ).rejects.toThrow("consumed");
  });

  it("rejects wrong product, Space, session, expiry, and weak secrets", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    for (const expected of [
      { productId: "drive" as const, spaceId: "space_1", sessionId: "session_1" },
      { productId: "photos" as const, spaceId: "space_2", sessionId: "session_1" },
      { productId: "photos" as const, spaceId: "space_1", sessionId: "session_2" },
    ]) {
      await expect(
        verifyAndConsumeRealtimeTicket(ticket, expected, secret, store(), 110),
      ).rejects.toThrow("binding");
    }
    await expect(
      verifyAndConsumeRealtimeTicket(
        ticket,
        {
          productId: "photos",
          spaceId: "space_1",
          sessionId: "session_1",
        },
        secret,
        store(),
        131,
      ),
    ).rejects.toThrow("expiry");
    await expect(issueRealtimeTicket(claims, "weak")).rejects.toThrow("32");
  });

  it("rejects tampering, invalid claim lifetimes, and future tickets", async () => {
    const ticket = await issueRealtimeTicket(claims, secret);
    const [payload, signature] = ticket.split(".");
    await expect(
      verifyAndConsumeRealtimeTicket(
        `${payload}.${signature.slice(0, -1)}x`,
        { productId: "photos", spaceId: "space_1", sessionId: "session_1" },
        secret,
        store(),
        110,
      ),
    ).rejects.toThrow("Invalid");
    await expect(
      issueRealtimeTicket({ ...claims, expiresAt: 161 }, secret),
    ).rejects.toThrow("60");
    const future = await issueRealtimeTicket(
      { ...claims, issuedAt: 200, expiresAt: 230 },
      secret,
    );
    await expect(
      verifyAndConsumeRealtimeTicket(
        future,
        { productId: "photos", spaceId: "space_1", sessionId: "session_1" },
        secret,
        store(),
        110,
      ),
    ).rejects.toThrow("binding");
  });

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
});
