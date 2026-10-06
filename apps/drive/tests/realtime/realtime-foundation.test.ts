import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";
import { folderListingId } from "@/lib/storage/folders";
import { createRealtimeToken } from "@/lib/realtime/token";
import {
  parseRealtimeEvent,
  shouldDisconnectRealtimeSocket,
} from "@xenode/realtime";

const originalEnv = {
  REALTIME_TICKET_SECRET: process.env.REALTIME_TICKET_SECRET,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
};

function restore(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("realtime foundation", () => {
  afterEach(() => {
    restore("REALTIME_TICKET_SECRET");
    restore("BETTER_AUTH_SECRET");
  });

  it("identifies folder listings by folder id, with the Space root as root", () => {
    expect(folderListingId(null)).toBe("root");
    expect(folderListingId(undefined)).toBe("root");
    expect(folderListingId("65f0c0ffee0000000000abcd")).toBe("65f0c0ffee0000000000abcd");
  });

  it("normalizes database identifiers and dates for socket payloads", () => {
    const snapshot = toSyncObjectSnapshot({
      _id: { toJSON: () => "object-1" },
      bucketId: { toJSON: () => "bucket-1" },
      key: "users/u1/file",
      size: 12,
      contentType: "application/octet-stream",
      createdAt: new Date("2026-06-20T10:00:00.000Z"),
    });
    expect(snapshot._id).toBe("object-1");
    expect(snapshot.bucketId).toBe("bucket-1");
    expect(snapshot.createdAt).toBe("2026-06-20T10:00:00.000Z");
  });

  it("builds product and Space scoped events", () => {
    expect(
      createSyncEvent(
        {
          userId: "acct_1",
          productId: "photos",
          spaceId: "space_1",
          type: "ACCESS_REVOKED",
          payload: { reason: "membership_removed" },
        },
        "event_1",
        new Date("2026-07-15T20:00:00.000Z"),
      ),
    ).toMatchObject({
      id: "event_1",
      userId: "acct_1",
      productId: "photos",
      spaceId: "space_1",
      type: "ACCESS_REVOKED",
    });
  });

  it("issues a 60-second ticket bound to account, product, Space, session, origin and session expiry", async () => {
    process.env.REALTIME_TICKET_SECRET = "r".repeat(48);
    process.env.BETTER_AUTH_SECRET = "a".repeat(48);
    const sessionExpiresAt = new Date(Date.now() + 3_600_000);
    const { token, expiresAt } = await createRealtimeToken({
      accountId: "acct_1",
      productId: "drive",
      spaceId: "space_1",
      sessionId: "session_1",
      sessionExpiresAt,
      origin: "https://drive.example.test",
    });
    const [body, signature] = token.split(".");
    const expected = createHmac("sha256", process.env.REALTIME_TICKET_SECRET)
      .update(body)
      .digest("base64url");
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    expect(signature).toBe(expected);
    expect(payload).toMatchObject({
      accountId: "acct_1",
      productId: "drive",
      spaceId: "space_1",
      sessionId: "session_1",
      origin: "https://drive.example.test",
      sessionExpiresAt: Math.floor(sessionExpiresAt.getTime() / 1000),
    });
    expect(Number(payload.expiresAt) - Number(payload.issuedAt)).toBe(60);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects missing, weak, or reused realtime and CDN secrets", async () => {
    process.env.BETTER_AUTH_SECRET = "a".repeat(48);
    delete process.env.REALTIME_TICKET_SECRET;
    await expect(
      createRealtimeToken({
        accountId: "acct_1",
        productId: "drive",
        spaceId: "space_1",
        sessionId: "session_1",
        sessionExpiresAt: new Date(Date.now() + 60_000),
        origin: null,
      }),
    ).rejects.toThrow("32 bytes");

    process.env.REALTIME_TICKET_SECRET = process.env.BETTER_AUTH_SECRET;
    await expect(
      createRealtimeToken({
        accountId: "acct_1",
        productId: "drive",
        spaceId: "space_1",
        sessionId: "session_1",
        sessionExpiresAt: new Date(Date.now() + 60_000),
        origin: null,
      }),
    ).rejects.toThrow("independent");

    process.env.REALTIME_TICKET_SECRET = "r".repeat(48);
  });


  it("propagates product-session revocation only to the matching session", () => {
    const parsed = parseRealtimeEvent(
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
    expect(parsed).toMatchObject({
      kind: "session-revoked",
      room: "product:photos:account:acct_1",
      markerKey: "realtime:revoked-session:session_1",
    });
    expect(
      shouldDisconnectRealtimeSocket(parsed!, {
        accountId: "acct_1",
        productId: "photos",
        sessionId: "session_1",
      }),
    ).toBe(true);
    expect(
      shouldDisconnectRealtimeSocket(parsed!, {
        accountId: "acct_1",
        productId: "photos",
        sessionId: "session_2",
      }),
    ).toBe(false);
  });

  it("propagates access revocation only within the bound product and Space", () => {
    const parsed = parseRealtimeEvent({
      id: "event_2",
      type: "ACCESS_REVOKED",
      userId: "acct_1",
      productId: "drive",
      spaceId: "space_1",
      occurredAt: "2026-07-15T23:00:00.000Z",
      payload: { reason: "member_removed" },
    });
    expect(parsed).toMatchObject({
      kind: "access-revoked",
      room: "product:drive:space:space_1",
      markerKey: "realtime:revoked-access:acct_1:drive:space_1",
      markerTtl: 60,
    });
    expect(
      shouldDisconnectRealtimeSocket(parsed!, {
        accountId: "acct_1",
        productId: "drive",
        spaceId: "space_1",
      }),
    ).toBe(true);
    expect(
      shouldDisconnectRealtimeSocket(parsed!, {
        accountId: "acct_1",
        productId: "photos",
        spaceId: "space_1",
      }),
    ).toBe(false);
    expect(parseRealtimeEvent("{invalid")).toBeNull();
  });

});
