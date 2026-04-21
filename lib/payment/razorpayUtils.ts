import crypto from "crypto";

/**
 * Verifies the Razorpay webhook signature.
 * 
 * @param body The raw request body as string
 * @param signature The signature from 'x-razorpay-signature' header
 * @param secret The webhook secret configured in Razorpay dashboard
 * @returns boolean
 */
export function verifyRazorpaySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return expectedSignature === signature;
}

/**
 * Standardized logging for payment activities.
 */
export const paymentLogger = {
  info: (msg: string, data?: any) => console.log(`[PAYMENT][INFO] ${msg}`, data || ""),
  error: (msg: string, error?: any) => console.error(`[PAYMENT][ERROR] ${msg}`, error || ""),
};
