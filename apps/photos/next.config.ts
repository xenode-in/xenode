import { getServerProductOrigin } from "@xenode/config";
import { getPublicRealtimeOrigin } from "@xenode/config/client";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

// Single source of truth for env: load the monorepo-root .env.local so all
// three apps share one file instead of a per-app .env.local.
loadEnvConfig(
  resolve(process.cwd(), "..", ".."),
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const accountsOrigin = new URL(
      getServerProductOrigin("accounts"),
    ).origin;
    // Drive's server hosts the realtime socket (WebSocket-only).
    const realtime = new URL(
      getPublicRealtimeOrigin(),
    );
    const socketOrigin = `${realtime.protocol === "https:" ? "wss" : "ws"}://${realtime.host}`;
    // Presigned R2 URLs are path-style, so each configured endpoint is exactly
    // one origin. Endpoints are validated where the storage client is built.
    const storageOrigins = ["S3_ENDPOINT", "S3_US_ENDPOINT", "S3_EU_ENDPOINT"]
      .map((name) => process.env[name]?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value).origin);
    const connectSrc = ["'self'", accountsOrigin, socketOrigin, ...new Set(storageOrigins)].join(" ");
    return [{
      source: "/((?!auth/logout/cleanup).*)",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src ${accountsOrigin}; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src ${connectSrc}; worker-src 'self' blob:` },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" }
      ],
    }];
  },
};

export default nextConfig;
