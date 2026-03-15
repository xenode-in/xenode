/**
 * CVE-1: Hash Validation Always-On
 *
 * Tests that the PayU success callback ALWAYS verifies the HMAC-SHA512 hash
 * and rejects tampered payloads regardless of environment variables.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { computePayuHash, makeUserId, makeTxnid, createUsage, createPendingTxn } from "../helpers/factories";

const PAYU_KEY  = "test_key";
const PAYU_SALT = "test_salt";

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  return fd;
}

describe("CVE-1 — Hash Validation", () => {
  const userId = makeUserId();
  const txnid  = makeTxnid();
  const amount = "149.00";
  const productinfo = "Basic";
  const email = "test@xenode.app";
  const firstname = "Test";

  beforeEach(async () => {
    await createUsage({ userId });
    await createPendingTxn({ txnid, userId, planName: productinfo });
    process.env.PAYU_MERCHANT_KEY  = PAYU_KEY;
    process.env.PAYU_MERCHANT_SALT = PAYU_SALT;
    process.env.NODE_ENV = "production";
  });

  it("accepts a correctly signed success payload", async () => {
    const hash = computePayuHash({
      salt: PAYU_SALT, status: "success", udf1: userId,
      email, firstname, productinfo, amount, txnid, key: PAYU_KEY,
    });

    const fd = buildFormData({ status: "success", txnid, amount, productinfo,
      email, firstname, udf1: userId, hash });

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    // Should redirect to success, NOT to hash_mismatch
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).not.toContain("hash_mismatch");
  });

  it("rejects a tampered hash in production — returns hash_mismatch redirect", async () => {
    const fd = buildFormData({
      status: "success", txnid, amount, productinfo,
      email, firstname, udf1: userId,
      hash: "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    });

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();
    expect(body).toContain("hash_mismatch");
  });

  it("rejects even when PAYU_TEST_MODE env is missing (old bypass vector)", async () => {
    delete process.env.PAYU_TEST_MODE; // simulate missing env
    process.env.NODE_ENV = "production";

    const fd = buildFormData({
      status: "success", txnid, amount, productinfo,
      email, firstname, udf1: userId,
      hash: "badhash",
    });

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    const res = await POST(req as any);
    const body = await res.text();
    expect(body).toContain("hash_mismatch");
  });

  it("allows bad hash in development with a console warning (not production)", async () => {
    process.env.NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const hash = computePayuHash({
      salt: PAYU_SALT, status: "success", udf1: userId,
      email, firstname, productinfo, amount, txnid, key: PAYU_KEY,
    });
    // Deliberately corrupt the hash by one char
    const badHash = hash.replace(hash[0], hash[0] === "a" ? "b" : "a");

    const fd = buildFormData({
      status: "success", txnid, amount, productinfo,
      email, firstname, udf1: userId, hash: badHash,
    });

    const req = new Request("http://localhost/api/payment/payu/success", {
      method: "POST", body: fd,
    });

    const { POST } = await import("@/app/api/payment/payu/success/route");
    await POST(req as any);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SECURITY WARNING")
    );
    warnSpy.mockRestore();
  });
});
