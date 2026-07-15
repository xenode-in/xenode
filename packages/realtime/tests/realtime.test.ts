import { describe, expect, it } from "vitest";
import {
  issueRealtimeTicket,
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
  productId: "photos",
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
      { productId: "drive", spaceId: "space_1", sessionId: "session_1" },
      { productId: "photos", spaceId: "space_2", sessionId: "session_1" },
      { productId: "photos", spaceId: "space_1", sessionId: "session_2" },
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
});
