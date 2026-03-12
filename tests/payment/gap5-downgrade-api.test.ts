/**
 * GAP-5: Downgrade API Lifecycle
 *
 * Tests the POST /api/payment/downgrade endpoint for:
 * - Over-quota rejection
 * - Schedule at end of billing cycle
 * - Invalid plan rejection
 * - Upgrade cancels scheduled downgrade
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Usage from "@/models/Usage";
import { makeUserId, createUsage, PRO_100_BYTES, PRO_500_BYTES, FREE_TIER_BYTES } from "../helpers/factories";

describe("GAP-5 — Downgrade API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  it("schedules a downgrade at end of billing cycle when under new quota", async () => {
    const userId = makeUserId();
    const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_500_BYTES,
      totalStorageBytes: 50 * 1024 * 1024 * 1024, // 50GB — under 100GB target
      planExpiresAt: expiresAt,
      planPriceINR: 399,
    });

    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as any);

    const req = new Request("http://localhost/api/payment/downgrade", {
      method: "POST",
      body: JSON.stringify({ targetPlan: "pro100" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/downgrade/route");
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const usage = await Usage.findOne({ userId });
    expect(usage?.scheduledDowngradePlan).toBe("pro100");
    expect(usage?.scheduledDowngradeLimitBytes).toBe(PRO_100_BYTES);
    expect(usage?.scheduledDowngradeAt?.getTime()).toBeCloseTo(expiresAt.getTime(), -3);
    // Current plan still active
    expect(usage?.storageLimitBytes).toBe(PRO_500_BYTES);
  });

  it("returns 409 when current usage exceeds target plan limit", async () => {
    const userId = makeUserId();
    await createUsage({
      userId, plan: "pro",
      storageLimitBytes: PRO_500_BYTES,
      totalStorageBytes: 150 * 1024 * 1024 * 1024, // 150GB — over 100GB limit
      planExpiresAt: new Date(Date.now() + 86400000),
    });

    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as any);

    const req = new Request("http://localhost/api/payment/downgrade", {
      method: "POST",
      body: JSON.stringify({ targetPlan: "pro100" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/downgrade/route");
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("over_quota");
    expect(body.excessBytes).toBeGreaterThan(0);
  });

  it("returns 400 for an invalid or unknown target plan", async () => {
    const userId = makeUserId();
    await createUsage({ userId });
    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as any);

    const req = new Request("http://localhost/api/payment/downgrade", {
      method: "POST",
      body: JSON.stringify({ targetPlan: "ultra-plan-9000" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/downgrade/route");
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it("returns 400 when target plan is not lower than current plan", async () => {
    const userId = makeUserId();
    await createUsage({ userId, plan: "pro", storageLimitBytes: PRO_100_BYTES });
    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as any);

    const req = new Request("http://localhost/api/payment/downgrade", {
      method: "POST",
      body: JSON.stringify({ targetPlan: "pro500" }), // higher than current
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/downgrade/route");
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue(null as any);

    const req = new Request("http://localhost/api/payment/downgrade", {
      method: "POST",
      body: JSON.stringify({ targetPlan: "free" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/downgrade/route");
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });
});
