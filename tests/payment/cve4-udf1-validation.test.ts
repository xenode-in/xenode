/**
 * CVE-4: udf1 Strict ObjectId Validation
 *
 * Tests that the callback aborts immediately if udf1 is missing,
 * invalid, or not a MongoDB ObjectId. No email-based fallback.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Usage from "@/models/Usage";
import { makeUserId, makeTxnid, createUsage, createPendingTxn, FREE_TIER_BYTES, PRO_100_BYTES } from "../helpers/factories";

describe("CVE-4 — udf1 Strict Validation", () => {
  beforeEach(() => {
    process.env.PAYU_MERCHANT_KEY  = "test_key";
    process.env.PAYU_MERCHANT_SALT = "test_salt";
    process.env.NODE_ENV = "development";
  });

  it("rejects callback when udf1 is missing entirely", async () => {
    const fd = new FormData();
    [["status","success"],["txnid",makeTxnid()],["amount","149.00"],
     ["productinfo","Basic"],["email","t@x.app"],["firstname","T"],["hash","x"]]
      .forEach(([k,v]) => fd.append(k,v));
    // udf1 intentionally omitted

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();
    expect(body).toContain("invalid_session");
  });

  it("rejects callback when udf1 is not a valid ObjectId", async () => {
    const fd = new FormData();
    [["status","success"],["txnid",makeTxnid()],["amount","149.00"],
     ["productinfo","Basic"],["email","t@x.app"],["firstname","T"],
     ["udf1","not-an-objectid"],["hash","x"]]
      .forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();
    expect(body).toContain("invalid_session");
  });

  it("does NOT fall back to email lookup when udf1 is invalid", async () => {
    const victimUserId = makeUserId();
    await createUsage({ userId: victimUserId });
    // Attacker sends victim email + invalid udf1 hoping for email fallback
    const fd = new FormData();
    [["status","success"],["txnid",makeTxnid()],["amount","149.00"],
     ["productinfo","Basic"],["email","victim@xenode.app"],["firstname","V"],
     ["udf1","00000000000"],["hash","x"]] // invalid udf1
      .forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    await POST(req as any);

    // Victim's quota must be untouched
    const usage = await Usage.findOne({ userId: victimUserId });
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_BYTES);
    expect(usage?.plan).toBe("free");
  });
});
