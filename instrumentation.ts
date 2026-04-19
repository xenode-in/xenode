export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Import the razorpay library to ensure it's initialized on server startup
    // This will throw an error early if environment variables are missing
    await import("@/lib/razorpay");
    console.log("✓ Razorpay SDK logic initialized on server startup");
  }
}
