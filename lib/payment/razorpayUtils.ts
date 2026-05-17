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

  // Constant-time comparison: Razorpay returns hex strings (64 chars for sha256).
  // Bail before timingSafeEqual if lengths differ — that function throws otherwise.
  if (expectedSignature.length !== signature.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Standardized logging for payment activities.
 */
export const paymentLogger = {
  info: (msg: string, data?: any) => console.log(`[PAYMENT][INFO] ${msg}`, data || ""),
  error: (msg: string, error?: any) => console.error(`[PAYMENT][ERROR] ${msg}`, error || ""),
};

/**
 * Razorpay offer IDs have a strict format: `offer_` followed by exactly 14
 * alphanumeric characters, totalling 20 chars. The API rejects anything else
 * with: "The offer id must be 20 characters." Validate before passing the
 * value to subscriptions.create / subscriptions.update so we fail loudly with
 * a useful message instead of bubbling a 400 from Razorpay.
 *
 * https://razorpay.com/docs/api/payments/subscriptions/create-subscription/
 */
export function isValidRazorpayOfferId(id: unknown): id is string {
  return typeof id === "string" && /^offer_[A-Za-z0-9]{14}$/.test(id);
}

/**
 * Strip null/undefined/empty-string entries from a notes payload. Razorpay
 * accepts up to 15 key-value pairs but empty values are noise — and in some
 * SDK paths can cause silent rejection.
 */
export function cleanNotes(
  notes: Record<string, string | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Identifies an error thrown by the razorpay-node SDK. Errors typically have:
 *   { statusCode: number, error: { code, description, field? } }
 */
export interface RazorpaySDKError {
  statusCode?: number;
  error?: {
    code?: string;
    description?: string;
    field?: string;
  };
}

export function isRazorpaySDKError(e: unknown): e is RazorpaySDKError {
  if (!e || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  const inner = obj.error;
  return (
    typeof obj.statusCode === "number" &&
    typeof inner === "object" &&
    inner !== null &&
    typeof (inner as Record<string, unknown>).description === "string"
  );
}
