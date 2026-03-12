/**
 * CVE-2: Idempotency Guard + Atomic Transaction
 *
 * Tests that replaying the PayU success callback with the same txnid
 * does NOT re-upgrade the user's storage quota or create duplicate Payment records.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import { computePayuHash, makeUserId, makeTxnid, createUsage, createPendingTxn, createPayment, PRO_100_BYTES, FREE_TIER_BYTES } from "../helpers/factories";

const PAYU_KEY  = "test_key";
const PAYU_SALT = "test_salt";

function makeSuccessFormData(fields: {
  txnid: string; userId: string; amount?: string;
  productinfo?: string; email?: string; firstname?: string;
}): FormData {
  const { txnid, userId, amount = "149.00", productinfo = "100GB Model",
    email = "test@xenode.app", firstname = "Test" } = fields;
  const hash = computePayuHash({
    salt: PAYU_SALT, status: "success", udf1: userId,
    email, firstname, productinfo, amount, txnid, key: PAYU_KEY,
  });
  const fd = new FormData();
  [{ status: "success" }, { txnid }, { amount }, { productinfo },
   { email }, { firstname }, { udf1: userId }, { hash }]
    .forEach(o => Object.entries(o).forEach(([k, v]) => fd.append(k, v)));
  return fd;
}

describe("CVE-2 — Idempotency", () => {
  beforeEach(() => {
    process.env.PAYU_MERCHANT_KEY  = PAYU_KEY;
    process.env.PAYU_MERCHANT_SALT = PAYU_SALT;
    process.env.NODE_ENV = "development"; // skip hash for isolation
  });

  it("processes a first-time success callback and upgrades quota exactly once", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    await createPendingTxn({ txnid, userId, storageLimitBytes: PRO_100_BYTES, planPriceINR: 149 });

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST",
      body: makeSuccessFormData({ txnid, userId }),
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    await POST(req as any);

    const usage = await Usage.findOne({ userId });
    expect(usage?.storageLimitBytes).toBe(PRO_100_BYTES);
    expect(usage?.plan).toBe("pro");

    const payments = await Payment.find({ txnid });
    expect(payments).toHaveLength(1);
  });

  it("replaying the same txnid does NOT double-upgrade quota", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    await createPendingTxn({ txnid, userId, storageLimitBytes: PRO_100_BYTES, planPriceINR: 149 });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const makeReq = () => new Request("http://localhost/api/payment/payu/success", {
      method: "POST",
      body: makeSuccessFormData({ txnid, userId }),
    });

    await POST(makeReq() as any);
    await POST(makeReq() as any); // replay
    await POST(makeReq() as any); // replay again

    // Usage should still only reflect one upgrade
    const usage = await Usage.findOne({ userId });
    expect(usage?.storageLimitBytes).toBe(PRO_100_BYTES);

    // Payment records must be exactly 1 (unique txnid)
    const payments = await Payment.find({ txnid });
    expect(payments).toHaveLength(1);
  });

  it("replaying after a successful payment returns success redirect without DB write", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    // Pre-seed: payment already exists (already processed)
    await createUsage({ userId, plan: "pro", storageLimitBytes: PRO_100_BYTES });
    await createPayment({ userId, txnid, status: "success" });

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST",
      body: makeSuccessFormData({ txnid, userId }),
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();

    // Should redirect to success
    expect(body).toContain("success=true");
    // Payment count must still be 1
    const payments = await Payment.find({ txnid });
    expect(payments).toHaveLength(1);
  });

  it("resets planExpiresAt to a fresh 30 days only once, not on replay", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    await createPendingTxn({ txnid, userId, storageLimitBytes: PRO_100_BYTES, planPriceINR: 149 });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const makeReq = () => new Request("http://localhost/api/payment/payu/success", {
      method: "POST",
      body: makeSuccessFormData({ txnid, userId }),
    });

    await POST(makeReq() as any);
    const first = await Usage.findOne({ userId });
    const firstExpiry = first?.planExpiresAt?.getTime();

    await new Promise(r => setTimeout(r, 50));
    await POST(makeReq() as any); // replay

    const second = await Usage.findOne({ userId });
    // planExpiresAt must not change on replay
    expect(second?.planExpiresAt?.getTime()).toBe(firstExpiry);
  });
});
