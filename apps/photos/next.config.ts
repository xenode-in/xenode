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
    return [{
      source: "/((?!auth/logout/cleanup).*)",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' http://localhost:3001 https://accounts.xenode.in https://*.r2.cloudflarestorage.com; worker-src 'self' blob:" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" }
      ],
    }];
  },
};

export default nextConfig;
