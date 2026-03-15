import { createHmac } from "crypto";
const SECRET = process.env.BETTER_AUTH_SECRET || "changeme";
/**
 * Generate a short-lived HMAC signature for a file proxy URL.
 * The signature covers: bucket + key + expiry timestamp.
 *
 * Uses a time-windowed approach to ensure the generated URL is identical
 * for the duration of the `expiresIn` window, allowing CDN edge caching.
 */
export function generateFileToken(
  bucketName: string,
  key: string,
  expiresIn: number = 3600, // seconds
): { exp: number; sig: string } {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  // Time-Windowed Logic:
  // Find the start of the current time block (e.g., top of the current hour)
  const currentBlockStart = nowInSeconds - (nowInSeconds % expiresIn);

  // The expiration is the start of this block + the duration
  const exp = currentBlockStart + expiresIn;
  const payload = `${bucketName}:${key}:${exp}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");

  return { exp, sig };
}
/**
 * Verify a file proxy token. Returns true if valid and not expired.
 */
export function verifyFileToken(
  bucketName: string,
  key: string,
  exp: number,
  sig: string,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (now > exp) return false; // expired
  const payload = `${bucketName}:${key}:${exp}`;
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}
/**
 * Build the full signed proxy URL for a file.
 * Uses Azure CDN base URL if configured, otherwise falls back to the app URL.
 */
export function getSignedFileUrl(
  bucketName: string,
  key: string,
  expiresIn: number = 3600,
): string {
  const { exp, sig } = generateFileToken(bucketName, key, expiresIn);
  const base =
    process.env.AZURE_CDN_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/files/${bucketName}/${key}?exp=${exp}&sig=${sig}`;
}
