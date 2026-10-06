import { beforeEach, describe, expect, it, vi } from "vitest";

// A lazy client with offline queueing off: commands fail until connected.
vi.mock("ioredis", () => ({
  default: class FakeRedis {
    status = "wait";
    published: string[] = [];
    on() {}
    async connect() {
      if (this.status !== "wait") throw new Error("Redis is already connecting/connected");
      this.status = "connecting";
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.status = "ready";
    }
    multi() {
      const ops: string[] = [];
      const chain = {
        set: () => chain,
        publish: (_channel: string, message: string) => (ops.push(message), chain),
        exec: async () => {
          if (this.status !== "ready") throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
          this.published.push(...ops);
          return [];
        },
      };
      return chain;
    }
  },
}));

beforeEach(() => {
  globalThis.__xenodeAccountsRealtimeRedis = undefined;
  globalThis.__xenodeAccountsRealtimeConnect = undefined;
});

describe("session revocation publisher", () => {
  it("publishes every revocation of a batch, even while the first connect is in flight", async () => {
    const { publishProductSessionRevoked } = await import("@/lib/realtime");
    const revoke = (sessionId: string) => publishProductSessionRevoked({
      accountId: "account", productId: "drive", sessionId, sessionExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(Promise.all([revoke("a"), revoke("b"), revoke("c")])).resolves.toEqual([true, true, true]);
    const redis = globalThis.__xenodeAccountsRealtimeRedis as unknown as { published: string[] };
    expect(redis.published).toHaveLength(3);
  });
});
