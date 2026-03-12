/**
 * CVE-3: Plan Resolution from PendingTransaction (Server DB)
 *
 * Tests that storageLimitBytes is ALWAYS resolved from the server-side
 * PendingTransaction record, never from the client-supplied productinfo field.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Usage from "@/models/Usage";
import PendingTransaction from "@/models/PendingTransaction";
import { computePayuHash, makeUserId, makeTxnid, createUsage, createPendingTxn, PRO_100_BYTES, PRO_500_BYTES, FREE_TIER_BYTES } from "../helpers/factories";

const PAYU_KEY  = "test_key";
const PAYU_SALT = "test_salt";

describe("CVE-3 — Plan from PendingTransaction", () => {
  beforeEach(() => {
    process.env.PAYU_MERCHANT_KEY  = PAYU_KEY;
    process.env.PAYU_MERCHANT_SALT = PAYU_SALT;
    process.env.NODE_ENV = "development";
  });

  it("upgrades quota from PendingTransaction, not from productinfo", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    // PendingTransaction says 100GB
    await createPendingTxn({ txnid, userId, storageLimitBytes: PRO_100_BYTES, planName: "100GB Model" });

    const fd = new FormData();
    // productinfo says "2TB Model" — should be ignored
    [["status","success"],["txnid",txnid],["amount","149.00"],["productinfo","2TB Model"],
     ["email","t@x.app"],["firstname","T"],["udf1",userId],["hash","ignored"]]
      .forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    await POST(req as any);

    const usage = await Usage.findOne({ userId });
    // Must be 100GB from PendingTransaction — NOT 2TB from productinfo
    expect(usage?.storageLimitBytes).toBe(PRO_100_BYTES);
  });

  it("rejects callback when no PendingTransaction exists for txnid", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    // NO PendingTransaction seeded

    const fd = new FormData();
    [["status","success"],["txnid",txnid],["amount","149.00"],["productinfo","100GB Model"],
     ["email","t@x.app"],["firstname","T"],["udf1",userId],["hash","ignored"]]
      .forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();
    expect(body).toContain("transaction_not_found");

    // Usage must NOT be upgraded
    const usage = await Usage.findOne({ userId });
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_BYTES);
  });

  it("rejects if PendingTransaction userId does not match udf1", async () => {
    const realUserId  = makeUserId();
    const otherUserId = makeUserId();
    const txnid = makeTxnid();
    await createUsage({ userId: realUserId });
    // PendingTransaction belongs to realUserId
    await createPendingTxn({ txnid, userId: realUserId, storageLimitBytes: PRO_100_BYTES });

    const fd = new FormData();
    // Attacker supplies otherUserId as udf1
    [["status","success"],["txnid",txnid],["amount","149.00"],["productinfo","100GB Model"],
     ["email","atk@x.app"],["firstname","A"],["udf1",otherUserId],["hash","ignored"]]
      .forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();
    expect(body).toContain("transaction_not_found");

    // realUserId's quota must not change
    const usage = await Usage.findOne({ userId: realUserId });
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_BYTES);
  });

  it("PendingTransaction is deleted after successful processing", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    await createPendingTxn({ txnid, userId, storageLimitBytes: PRO_100_BYTES });

    const fd = new FormData();
    [["status","success"],["txnid",txnid],["amount","149.00"],["productinfo","100GB Model"],
     ["email","t@x.app"],["firstname","T"],["udf1",userId],["hash","ignored"]]
      .forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    await POST(req as any);

    const pending = await PendingTransaction.findOne({ txnid });
    expect(pending).toBeNull();
  });
});
