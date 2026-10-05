import { getServerProductOrigin } from "@xenode/config";
import { createHmac } from "crypto";

function signingSecret(): string {
  const value = process.env.CDN_SIGNING_SECRET;
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error("CDN_SIGNING_SECRET must be configured with at least 32 bytes");
  }
  if (
    value === process.env.BETTER_AUTH_SECRET ||
    value === process.env.REALTIME_TICKET_SECRET
  ) {
    throw new Error("CDN_SIGNING_SECRET must be independent");
  }
  return value;
}
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
  version: string = "",
): { exp: number; sig: string } {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  // Time-Windowed Logic:
  // Find the start of the current time block (e.g., top of the current hour)
  const currentBlockStart = nowInSeconds - (nowInSeconds % expiresIn);

  // The expiration is the start of this block + the duration
  const exp = currentBlockStart + expiresIn;
  const payload = `${bucketName}:${key}:${exp}${version ? ":" + version : ""}`;
  const sig = createHmac("sha256", signingSecret()).update(payload).digest("hex");

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
  version: string = "",
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (now > exp) return false; // expired
  const payload = `${bucketName}:${key}:${exp}${version ? ":" + version : ""}`;
  const expected = createHmac("sha256", signingSecret()).update(payload).digest("hex");
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}
/**
 * Return a URL on the configured public R2 bucket domain.
 */
export function getPublicB2Url(_bucketName: string, key: string): string {
  void _bucketName;
  const base = process.env.PUBLIC_S3_ENDPOINT;
  if (!base) throw new Error("PUBLIC_S3_ENDPOINT is required for public R2 assets");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_S3_ENDPOINT must be an HTTPS public origin");
  }
  return `${url.origin}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
/**
 * Build the full signed proxy URL for a file.
 * Uses Azure CDN base URL if configured, otherwise falls back to the app URL.
 */
export function getSignedFileUrl(
  bucketName: string,
  key: string,
  expiresIn: number = 3600,
  version?: string,
  baseUrl?: string,
): string {
  const { exp, sig } = generateFileToken(bucketName, key, expiresIn, version);
  const base =
    baseUrl ||
    process.env.AZURE_CDN_URL ||
    getServerProductOrigin("drive");
  
  let url = `${base.replace(/\/$/, "")}/api/files/${bucketName}/${key}?exp=${exp}&sig=${sig}`;
  if (version) {
    url += `&v=${encodeURIComponent(version)}`;
  }
  return url;
}
