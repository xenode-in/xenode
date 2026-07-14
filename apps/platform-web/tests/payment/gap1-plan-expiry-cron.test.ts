/**
 * GAP-1: Plan Expiry Cron
 *
 * Tests that the daily cron correctly expires lapsed plans.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
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

  it("grants grace period to a pro plan whose planExpiresAt is in the past", async () => {
    const userId = makeUserId();
    const originalExpiry = new Date(Date.now() - 1000); // expired
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_100_BYTES,
      planPriceINR: 149,
      planExpiresAt: originalExpiry,
    });

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.grantedGraceCount).toBe(1);
    expect(body.expiredCount).toBe(0);
    const usage = await Usage.findOne({ userId });
    // Plan stays "pro" during the grace window
    expect(usage?.plan).toBe("pro");
    expect(usage?.isGracePeriod).toBe(true);
    expect(usage?.gracePeriodEndsAt).toBeInstanceOf(Date);
    // planExpiresAt MUST NOT be overwritten — the UI relies on it for "Expired On"
    expect(usage?.planExpiresAt?.getTime()).toBe(originalExpiry.getTime());
  });

  it("downgrades to free when grace period has ended", async () => {
    const userId = makeUserId();
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_100_BYTES,
      planPriceINR: 149,
      planExpiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    // Force the user into a stale grace period whose deadline has passed.
    await Usage.updateOne(
      { userId },
      {
        $set: {
          isGracePeriod: true,
          gracePeriodEndsAt: new Date(Date.now() - 1000),
        },
      },
    );

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.expiredCount).toBe(1);
    const usage = await Usage.findOne({ userId });
    expect(usage?.plan).toBe("free");
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_LIMIT_BYTES);
    expect(usage?.isGracePeriod).toBe(false);
    expect(usage?.gracePeriodEndsAt).toBeNull();
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

  it("returns correct counts when a batch contains a mix of grace-eligible and grace-expired users", async () => {
    const [grace1, grace2, expired, freeUser] = [
      makeUserId(),
      makeUserId(),
      makeUserId(),
      makeUserId(),
    ];
    await Promise.all([
      // Fresh lapses — should be granted grace, not downgraded
      createUsage({
        userId: grace1,
        plan: "pro",
        storageLimitBytes: PRO_100_BYTES,
        planExpiresAt: new Date(Date.now() - 1),
      }),
      createUsage({
        userId: grace2,
        plan: "pro",
        storageLimitBytes: PRO_500_BYTES,
        planExpiresAt: new Date(Date.now() - 1000),
      }),
      // Already in grace with deadline elapsed — should be downgraded
      createUsage({
        userId: expired,
        plan: "pro",
        storageLimitBytes: PRO_100_BYTES,
        planExpiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      }),
      // Free user — should be untouched
      createUsage({ userId: freeUser, plan: "free", storageLimitBytes: FREE_TIER_BYTES }),
    ]);
    await Usage.updateOne(
      { userId: expired },
      {
        $set: {
          isGracePeriod: true,
          gracePeriodEndsAt: new Date(Date.now() - 1000),
        },
      },
    );

    const { GET } = await import("@/app/api/cron/expire-plans/route");
    const res = await GET(makeCronReq() as any);
    const body = await res.json();

    expect(body.grantedGraceCount).toBe(2);
    expect(body.expiredCount).toBe(1);
  });
});
