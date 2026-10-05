export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@xenode/config/server");
    getServerEnv();

    // Fail at startup, not on the first payment, when Razorpay is unconfigured.
    const { getRazorpayClient } = await import("@/lib/razorpay");
    getRazorpayClient();
  }
}
