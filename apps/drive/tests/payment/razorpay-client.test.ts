import { afterEach, describe, expect, it, vi } from "vitest";

// `next build` evaluates route modules without runtime secrets, so importing
// the client must not need them; using it must.
describe("Razorpay client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("imports without keys and refuses to be used without them", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    const { default: razorpay, getRazorpayClient } = await import("@/lib/razorpay");
    expect(() => razorpay.subscriptions).toThrow("RAZORPAY_KEY_ID");
    expect(() => getRazorpayClient()).toThrow("RAZORPAY_KEY_ID");
  });

  it("creates one client on first use", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    const { default: razorpay, getRazorpayClient } = await import("@/lib/razorpay");
    expect(razorpay.subscriptions).toBe(getRazorpayClient().subscriptions);
    expect(getRazorpayClient()).toBe(getRazorpayClient());
  });
});

describe("billing gateway errors", () => {
  it("passes a described 4xx through and reports any other SDK rejection as a gateway failure", async () => {
    const { jsonError } = await import("@/lib/billing/http");
    const described = jsonError({ statusCode: 400, error: { code: "BAD_REQUEST_ERROR", description: "Plan does not exist" } });
    expect(described.status).toBe(400);
    expect(await described.json()).toMatchObject({ error: "Plan does not exist" });
    // No JSON body (an HTML 404, an outage): not the caller's fault, and not a bare 500.
    const bodiless = jsonError({ statusCode: 404, error: undefined });
    expect(bodiless.status).toBe(502);
    expect(await bodiless.json()).toMatchObject({ error: "Payment gateway error" });
    expect(jsonError(new Error("boom")).status).toBe(500);
  });
});
