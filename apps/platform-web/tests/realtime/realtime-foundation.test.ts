import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  parentPrefixForKey,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";
import { createRealtimeToken } from "@/lib/realtime/token";

describe("realtime foundation", () => {
  const previousSecret = process.env.REALTIME_TOKEN_SECRET;

  afterEach(() => {
    process.env.REALTIME_TOKEN_SECRET = previousSecret;
  });

  it("derives the containing folder for files and folders", () => {
    expect(parentPrefixForKey("users/u1/root/file.bin")).toBe(
      "users/u1/root/",
    );
    expect(parentPrefixForKey("users/u1/root/nested/")).toBe(
      "users/u1/root/",
    );
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

  it("issues a short-lived signed token bound to the user", () => {
    process.env.REALTIME_TOKEN_SECRET = "test-realtime-secret";
    const { token, expiresAt } = createRealtimeToken("user-123");
    const [body, signature] = token.split(".");
    const expected = createHmac("sha256", "test-realtime-secret")
      .update(body)
      .digest("base64url");
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );

    expect(signature).toBe(expected);
    expect(payload.sub).toBe("user-123");
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(payload.exp * 1000).toBeLessThanOrEqual(
      Date.now() + 5 * 60 * 1000,
    );
  });
});
