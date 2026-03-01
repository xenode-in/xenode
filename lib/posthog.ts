import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

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

/**
 * Fire-and-forget PostHog server-side event capture.
 * Never throws — analytics must never break production.
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  void (async () => {
    try {
      const client = getClient();
      if (!client) return;
      client.capture({ distinctId, event, properties: properties ?? {} });
      await client.shutdown();
    } catch {
      // intentionally swallowed
    }
  })();
}

/**
 * Identify / update user properties in PostHog.
 * Call once after auth to keep user traits in sync.
 */
export function identifyUser(
  userId: string,
  properties: Record<string, unknown>
): void {
  void (async () => {
    try {
      const client = getClient();
      if (!client) return;
      client.identify({ distinctId: userId, properties });
      await client.shutdown();
    } catch {
      // intentionally swallowed
    }
  })();
}
