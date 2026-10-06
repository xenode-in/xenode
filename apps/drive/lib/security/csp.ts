import { getServerProductOrigin, validateWebOrigin } from "@xenode/config";
import { getPublicRealtimeOrigin } from "@xenode/config/client";

/** Exact origins only. This policy is generated per HTML request, never cached. */
export function driveContentSecurityPolicy(nonce: string, paymentPage: boolean) {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(nonce)) throw new Error("Invalid CSP nonce");
  const accounts = getServerProductOrigin("accounts");
  const editor = validateWebOrigin(process.env.NEXT_PUBLIC_ONLYOFFICE_EDITOR_ORIGIN || "https://edit.xenode.in", "NEXT_PUBLIC_ONLYOFFICE_EDITOR_ORIGIN");
  const preview = validateWebOrigin(process.env.NEXT_PUBLIC_SAFE_PREVIEW_ORIGIN || "https://preview.xenode.in", "NEXT_PUBLIC_SAFE_PREVIEW_ORIGIN");
  const realtime = new URL(getPublicRealtimeOrigin());
  const socket = `${realtime.protocol === "https:" ? "wss:" : "ws:"}//${realtime.host}`;
  const storage = ["S3_ENDPOINT", "S3_US_ENDPOINT", "S3_EU_ENDPOINT"].flatMap(name => {
    const value = process.env[name]?.trim();
    return value ? [validateWebOrigin(value, name)] : [];
  });
  const analytics = process.env.NEXT_PUBLIC_POSTHOG_KEY ? [validateWebOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com", "NEXT_PUBLIC_POSTHOG_HOST")] : [];
  const assets = process.env.PUBLIC_S3_ENDPOINT ? [validateWebOrigin(process.env.PUBLIC_S3_ENDPOINT, "PUBLIC_S3_ENDPOINT")] : [];
  const payment = paymentPage ? ["https://checkout.razorpay.com", "https://api.razorpay.com", "https://lumberjack.razorpay.com"] : [];
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${devEval}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com ${assets.join(" ")}`,
    "font-src 'self' data:", "media-src 'self' blob:", "worker-src 'self' blob:",
    `connect-src ${["'self'", accounts, socket, ...storage, ...analytics, ...payment].join(" ")}`,
    `frame-src ${[accounts, editor, preview, ...payment].join(" ")}`,
    "form-action 'self'", "manifest-src 'self'",
  ].join("; ");
}
