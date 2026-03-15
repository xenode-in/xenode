/**
 * GAP-1: Plan Expiry Cron
 *
 * Tests that the daily cron correctly expires lapsed plans.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Usage from "@/models/Usage";
import { makeUserId, createUsage, PRO_100_BYTES, PRO_500_BYTES, FREE_TIER_BYTES } from "../helpers/factories";

const CRON_SECRET = "test-cron-secret";

function makeCronReq() {
  return new Request("http://localhost/api/cron/expire-plans", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("GAP-1 — Plan Expiry Cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("rejects cron request without CRON_SECRET header", async () => {
    const req = new Request("http://localhost/api/cron/expire-plans");
    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it("rejects cron request with wrong secret", async () => {
    const req = new Request("http://localhost/api/cron/expire-plans", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it("expires a pro plan whose planExpiresAt is in the past", async () => {
    const userId = makeUserId();
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_100_BYTES,
      planPriceINR: 149,
      planExpiresAt: new Date(Date.now() - 1000), // expired
    });

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.expiredCount).toBe(1);
    const usage = await Usage.findOne({ userId });
    expect(usage?.plan).toBe("free");
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_BYTES);
  });

  it("does NOT expire a pro plan that is still active", async () => {
    const userId = makeUserId();
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_100_BYTES,
      planExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days future
    });

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    await GET(makeCronReq() as any);

    const usage = await Usage.findOne({ userId });
    expect(usage?.plan).toBe("pro");
  });

  it("returns correct counts for a batch of expired plans", async () => {
    const [u1, u2, u3] = [makeUserId(), makeUserId(), makeUserId()];
    await Promise.all([
      createUsage({ userId: u1, plan: "pro", storageLimitBytes: PRO_100_BYTES, planExpiresAt: new Date(Date.now() - 1) }),
      createUsage({ userId: u2, plan: "pro", storageLimitBytes: PRO_500_BYTES, planExpiresAt: new Date(Date.now() - 1000) }),
      createUsage({ userId: u3, plan: "free", storageLimitBytes: FREE_TIER_BYTES }),
    ]);

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.expiredCount).toBe(2);
  });
});
