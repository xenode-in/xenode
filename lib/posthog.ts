import { PostHog } from "posthog-node";

/**
 * Fire-and-forget PostHog server-side event capture.
 * Creates a short-lived client per call — correct for Next.js serverless
 * where long-lived singletons can cause events to be dropped on cold starts.
 * Never throws, never blocks the calling function.
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;

  void (async () => {
    try {
      const client = new PostHog(key, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
        flushAt: 1,
        flushInterval: 0,
      });
      client.capture({ distinctId, event, properties: properties ?? {} });
      await client.shutdown();
    } catch {
      // Analytics must never break production
    }
  })();
}

/**
 * Identify / update a user's properties in PostHog.
 * Call this after login or when user data changes.
 */
export function identifyUser(
  userId: string,
  properties: Record<string, unknown>
): void {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;

  void (async () => {
    try {
      const client = new PostHog(key, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
        flushAt: 1,
        flushInterval: 0,
      });
      client.identify({ distinctId: userId, properties });
      await client.shutdown();
    } catch {
      // Analytics must never break production
    }
  })();
}
