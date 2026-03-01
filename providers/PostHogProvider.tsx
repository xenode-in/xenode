"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (pathname && ph) {
      ph.capture("$pageview", { $current_url: window.location.href });
    }
  }, [pathname, searchParams, ph]);

  return null;
}

/**
 * Wrap your root layout with this provider.
 * Initialises PostHog once on the client, then tracks page views
 * on every Next.js route change via the inner PostHogPageView component.
 *
 * Required env vars:
 *   NEXT_PUBLIC_POSTHOG_KEY
 *   NEXT_PUBLIC_POSTHOG_HOST  (optional, defaults to https://app.posthog.com)
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
      capture_pageview: false, // handled manually below
      capture_pageleave: true,
      persistence: "localStorage",
      autocapture: false, // disable for GDPR compliance
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}
