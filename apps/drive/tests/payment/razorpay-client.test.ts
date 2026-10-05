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
