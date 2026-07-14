import crypto from "crypto";
import { PostHog } from "posthog-node";
import {
  sanitizeAnalyticsPath,
  sanitizeAnalyticsUrl,
} from "@/lib/analytics";

let _client: PostHog | null = null;

const ALLOWED_EVENTS = new Set([
  "$pageview",
  "bucket_created",
  "object_uploaded",
  "object_downloaded",
  "share_link_created",
  "direct_share_created",
  "onboarding_completed",
  "vault_configured",
  "subscription_checkout_started",
  "subscription_started",
  "subscription_cancelled",
  "mfa_enabled",
  "passkey_added",
]);

const ALLOWED_PROPERTY_KEYS = new Set([
  "$current_url",
  "path",
  "accessType",
  "shareType",
  "isPasswordProtected",
  "hasExpiry",
  "hasMaxDownloads",
  "sizeBucket",
  "contentTypeCategory",
  "isEncrypted",
  "objectCountBucket",
  "recipientCountBucket",
  "planSlug",
  "billingCycle",
  "offerApplied",
  "source",
  "method",
  "platform",
]);

function getClient(): PostHog | null {
  const key = process.env.POSTHOG_KEY;
  if (!key) return null;
  if (_client) return _client;
  _client = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });
  return _client;
}

function analyticsDistinctId(userId: string): string | null {
  const salt = process.env.POSTHOG_USER_ID_SALT || process.env.BETTER_AUTH_SECRET;
  if (!salt) return null;
  return crypto.createHmac("sha256", salt).update(userId).digest("hex");
}

export function sizeBucket(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return "lt_1mb";
  if (sizeBytes < 10 * 1024 * 1024) return "1mb_10mb";
  if (sizeBytes < 100 * 1024 * 1024) return "10mb_100mb";
  if (sizeBytes < 1024 * 1024 * 1024) return "100mb_1gb";
  if (sizeBytes < 10 * 1024 * 1024 * 1024) return "1gb_10gb";
  return "gte_10gb";
}

export function countBucket(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 20) return "6_20";
  if (count <= 100) return "21_100";
  return "gt_100";
}

export function contentTypeCategory(contentType?: string): string {
  const type = (contentType || "").toLowerCase();
  if (!type) return "unknown";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type.includes("zip") || type.includes("archive") || type.includes("compressed")) {
    return "archive";
  }
  if (type.includes("word") || type.includes("document")) return "document";
  if (type.includes("sheet") || type.includes("excel")) return "spreadsheet";
  if (type.includes("presentation") || type.includes("powerpoint")) return "presentation";
  if (type.startsWith("text/")) return "text";
  return "other";
}

export function sanitizeAnalyticsProperties(
  properties?: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  if (!properties) return {};
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      if (key === "path" && typeof value === "string") {
        sanitized[key] = sanitizeAnalyticsPath(value);
      } else if (key === "$current_url" && typeof value === "string") {
        sanitized[key] = sanitizeAnalyticsUrl(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  return sanitized;
}

/**
 * Fire-and-forget PostHog server-side event capture.
 * Never throws: analytics must never break production.
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const client = getClient();
      if (!client) return;
      if (!ALLOWED_EVENTS.has(event)) return;
      const distinctIdHash = analyticsDistinctId(distinctId);
      if (!distinctIdHash) return;
      client.capture({
        distinctId: distinctIdHash,
        event,
        properties: sanitizeAnalyticsProperties(properties),
      });
      await client.flush();
    } catch {
      // intentionally swallowed
    }
  })();
}

/**
 * Identify / update privacy-safe user properties in PostHog.
 */
export function identifyUser(
  userId: string,
  properties: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const client = getClient();
      if (!client) return;
      const distinctIdHash = analyticsDistinctId(userId);
      if (!distinctIdHash) return;
      client.identify({
        distinctId: distinctIdHash,
        properties: sanitizeAnalyticsProperties(properties),
      });
      await client.flush();
    } catch {
      // intentionally swallowed
    }
  })();
}
