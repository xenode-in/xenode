/**
 * GAP-1: Plan Expiry Cron
 *
 * Tests that the daily cron correctly expires lapsed plans,
 * applies scheduled downgrades, and blocks over-quota downgrades.
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

  it("applies a scheduled downgrade when usage is under new limit", async () => {
    const userId = makeUserId();
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_500_BYTES,
      planExpiresAt: new Date(Date.now() + 86400000),
      totalStorageBytes: 50 * 1024 * 1024 * 1024, // 50GB
      scheduledDowngradePlan: "pro100",
      scheduledDowngradeLimitBytes: PRO_100_BYTES,
      scheduledDowngradeAt: new Date(Date.now() - 1000), // due now
    });

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.downgradedCount).toBe(1);
    const usage = await Usage.findOne({ userId });
    expect(usage?.storageLimitBytes).toBe(PRO_100_BYTES);
    expect(usage?.scheduledDowngradePlan).toBeNull();
  });

  it("blocks a scheduled downgrade when usage exceeds new limit at cron time", async () => {
    const userId = makeUserId();
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_500_BYTES,
      totalStorageBytes: 200 * 1024 * 1024 * 1024, // 200GB — over 100GB limit
      scheduledDowngradePlan: "pro100",
      scheduledDowngradeLimitBytes: PRO_100_BYTES,
      scheduledDowngradeAt: new Date(Date.now() - 1000),
    });

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.downgradeBlockedCount).toBe(1);
    const usage = await Usage.findOne({ userId });
    // Plan must NOT be downgraded
    expect(usage?.storageLimitBytes).toBe(PRO_500_BYTES);
    expect(usage?.scheduledDowngradePlan).toBe("pro100");
  });

  it("returns correct counts for a mixed batch", async () => {
    const [u1, u2, u3] = [makeUserId(), makeUserId(), makeUserId()];
    await Promise.all([
      createUsage({ userId: u1, plan: "pro", storageLimitBytes: PRO_100_BYTES, planExpiresAt: new Date(Date.now() - 1) }),
      createUsage({ userId: u2, plan: "pro", storageLimitBytes: PRO_500_BYTES, totalStorageBytes: 50*1024**3, scheduledDowngradePlan: "pro100", scheduledDowngradeLimitBytes: PRO_100_BYTES, scheduledDowngradeAt: new Date(Date.now() - 1) }),
      createUsage({ userId: u3, plan: "free", storageLimitBytes: FREE_TIER_BYTES }),
    ]);

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.expiredCount).toBe(1);
    expect(body.downgradedCount).toBe(1);
    expect(body.downgradeBlockedCount).toBe(0);
  });
});
