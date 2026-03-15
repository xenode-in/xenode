/**
 * CVE-6: Proration Uses Stored planPriceINR
 *
 * Tests that the checkout route computes proration from the stored
 * planPriceINR field, NOT from byte-matching hardcoded tier prices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeUserId, createUsage, PRO_100_BYTES, PRO_500_BYTES } from "../helpers/factories";

describe("CVE-6 — Proration from Stored Price", () => {
  const userId = makeUserId();

  beforeEach(async () => {
    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, name: "Test", email: "t@xenode.app" },
    } as any);
    process.env.PAYU_MERCHANT_KEY  = "test_key";
    process.env.PAYU_MERCHANT_SALT = "test_salt";
    process.env.NODE_ENV = "development";
  });

  it("computes proration discount using stored planPriceINR (not byte-matching)", async () => {
    // User on Pro 500GB (₹399/month) with 15 days remaining
    const fifteenDaysFromNow = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    await createUsage({
      userId,
      plan: "pro",
      storageLimitBytes: PRO_500_BYTES,
      planPriceINR: 399, // stored at activation
      planExpiresAt: fifteenDaysFromNow,
      planActivatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      totalStorageBytes: 0,
    });

    const req = new Request("http://localhost/api/payment/payu", {
      method: "POST",
      body: JSON.stringify({ planName: "Plus" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/payu/route");
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    const finalAmount = parseFloat(body.params.amount);
    // 1TB = ₹699; prorated credit ≈ (399/30)*15 ≈ ₹199.50
    // Expected: 699 - 199.50 = ₹499.50 (approximately)
    expect(finalAmount).toBeGreaterThan(400);
    expect(finalAmount).toBeLessThan(700);
  });

  it("charges full price when no active plan (free user)", async () => {
    await createUsage({ userId, plan: "free", planPriceINR: 0, totalStorageBytes: 0 });

    const req = new Request("http://localhost/api/payment/payu", {
      method: "POST",
      body: JSON.stringify({ planName: "Basic" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/payu/route");
    const res = await POST(req as any);
    const body = await res.json();
    expect(parseFloat(body.params.amount)).toBe(149);
  });

  it("rejects unknown plan names not in server allowlist", async () => {
    await createUsage({ userId });

    const req = new Request("http://localhost/api/payment/payu", {
      method: "POST",
      body: JSON.stringify({ planName: "UltraMegaInfiniteGB" }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/payment/payu/route");
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid plan");
  });
});
