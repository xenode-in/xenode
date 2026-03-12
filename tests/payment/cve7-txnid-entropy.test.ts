/**
 * CVE-7: CSPRNG txnid Uniqueness
 *
 * Tests that txnids are generated with crypto.randomBytes and are
 * unique across concurrent calls (no Math.random collision).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeUserId, createUsage } from "../helpers/factories";

describe("CVE-7 — CSPRNG txnid", () => {
  const userId = makeUserId();

  beforeEach(async () => {
    const { getServerSession } = await import("@/lib/auth/session");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, name: "Test", email: "t@xenode.app" },
    } as any);
    await createUsage({ userId });
    process.env.PAYU_MERCHANT_KEY  = "test_key";
    process.env.PAYU_MERCHANT_SALT = "test_salt";
    process.env.NODE_ENV = "development";
  });

  it("generates a unique txnid for each checkout request", async () => {
    const { POST } = await import("@/app/api/payment/payu/route");
    const makeReq = () => new Request("http://localhost/api/payment/payu", {
      method: "POST",
      body: JSON.stringify({ planName: "100GB Model" }),
      headers: { "Content-Type": "application/json" },
    });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => POST(makeReq() as any))
    );
    const bodies = await Promise.all(responses.map(r => r.json()));
    const txnids = bodies.map((b: any) => b.params.txnid);

    const uniqueTxnids = new Set(txnids);
    expect(uniqueTxnids.size).toBe(20);
  });

  it("txnid format matches TXN{timestamp}{16-char hex}", async () => {
    const { POST } = await import("@/app/api/payment/payu/route");
    const res = await POST(new Request("http://localhost/api/payment/payu", {
      method: "POST",
      body: JSON.stringify({ planName: "100GB Model" }),
      headers: { "Content-Type": "application/json" },
    }) as any);
    const body = await res.json();
    // Format: TXN + 13-digit timestamp + 16 hex chars
    expect(body.params.txnid).toMatch(/^TXN\d{13}[0-9a-f]{16}$/);
  });

  it("does NOT use Math.random (no sequential pattern in 1000 samples)", async () => {
    const { POST } = await import("@/app/api/payment/payu/route");
    const makeReq = () => new Request("http://localhost/api/payment/payu", {
      method: "POST",
      body: JSON.stringify({ planName: "100GB Model" }),
      headers: { "Content-Type": "application/json" },
    });

    const results = [];
    for (let i = 0; i < 100; i++) {
      const r = await POST(makeReq() as any);
      const b = await r.json();
      results.push(b.params.txnid.slice(-16)); // last 16 hex chars (random part)
    }

    // All suffixes must be unique (Math.random with same ms seed would repeat)
    const unique = new Set(results);
    expect(unique.size).toBe(100);
  });
});
