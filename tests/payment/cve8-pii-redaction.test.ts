/**
 * CVE-8: PII Redaction in payuResponse
 *
 * Tests that the Payment model never stores email, phone, firstname,
 * or udf1 in the payuResponse field for both success and failure callbacks.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Payment from "@/models/Payment";
import { makeUserId, makeTxnid, createUsage, createPendingTxn, PRO_100_BYTES } from "../helpers/factories";

describe("CVE-8 — PII Redaction", () => {
  beforeEach(() => {
    process.env.PAYU_MERCHANT_KEY  = "test_key";
    process.env.PAYU_MERCHANT_SALT = "test_salt";
    process.env.NODE_ENV = "development";
  });

  it("success callback: payuResponse does NOT contain email, phone, or firstname", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();
    await createUsage({ userId });
    await createPendingTxn({ txnid, userId, storageLimitBytes: PRO_100_BYTES });

    const fd = new FormData();
    [
      ["status","success"],["txnid",txnid],["amount","149.00"],
      ["productinfo","100GB Model"],["email","private@xenode.app"],
      ["phone","9876543210"],["firstname","PrivateUser"],
      ["udf1",userId],["mode","CC"],["PG_TYPE","VISA"],["bank_ref_num","REF123"],
      ["hash","ignored"],
    ].forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    await POST(req as any);

    const payment = await Payment.findOne({ txnid });
    expect(payment).not.toBeNull();

    const resp = payment!.payuResponse as any;
    expect(resp.email).toBeUndefined();
    expect(resp.phone).toBeUndefined();
    expect(resp.firstname).toBeUndefined();
    expect(resp.udf1).toBeUndefined();

    // Safe fields must be present
    expect(resp.status).toBe("success");
    expect(resp.txnid).toBe(txnid);
    expect(resp.mode).toBe("CC");
    expect(resp.PG_TYPE).toBe("VISA");
    expect(resp.bank_ref_num).toBe("REF123");
  });

  it("failure callback: payuResponse does NOT contain PII", async () => {
    const userId = makeUserId();
    const txnid  = makeTxnid();

    const fd = new FormData();
    [
      ["status","failure"],["txnid",txnid],["amount","149.00"],
      ["productinfo","100GB Model"],["email","private@xenode.app"],
      ["phone","9876543210"],["firstname","PrivateUser"],
      ["udf1",userId],["mode","CC"],["error","E001"],["error_Message","Card declined"],
    ].forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/failure", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/failure/route");
    await POST(req as any);

    const payment = await Payment.findOne({ txnid });
    expect(payment).not.toBeNull();

    const resp = payment!.payuResponse as any;
    expect(resp.email).toBeUndefined();
    expect(resp.phone).toBeUndefined();
    expect(resp.firstname).toBeUndefined();
    expect(resp.error).toBe("E001");
    expect(resp.error_Message).toBe("Card declined");
  });

  it("failure callback: console.error log does NOT include email or phone", async () => {
    const txnid = makeTxnid();
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const fd = new FormData();
    [
      ["status","failure"],["txnid",txnid],["amount","149.00"],
      ["productinfo","100GB Model"],["email","shouldnotlog@xenode.app"],
      ["phone","9876543210"],["firstname","Secret"],["udf1","someid"],
    ].forEach(([k,v]) => fd.append(k,v));

    const req = new Request("http://localhost/api/payment/payu/failure", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/failure/route");
    await POST(req as any);

    const loggedArgs = logSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).not.toContain("shouldnotlog@xenode.app");
    expect(loggedArgs).not.toContain("9876543210");
    expect(loggedArgs).not.toContain("Secret");

    logSpy.mockRestore();
  });
});
