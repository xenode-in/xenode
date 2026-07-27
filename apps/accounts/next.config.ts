import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

// Single source of truth for env: load the monorepo-root .env.local so all
// three apps share one file instead of a per-app .env.local. forceReload=true
// overrides @next/env's memoized (empty) app-dir load.
loadEnvConfig(
  resolve(process.cwd(), "..", ".."),
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    const driveOrigin =
      process.env.DRIVE_ORIGIN ??
      (process.env.NODE_ENV === "production"
        ? "https://drive.xenode.in"
        : "http://localhost:3000");
    const photosOrigin =
      process.env.PHOTOS_ORIGIN ??
      (process.env.NODE_ENV === "production"
        ? "https://photos.xenode.in"
        : "http://localhost:3002");
    return [
      {
        source: "/logout",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src ${new URL(driveOrigin).origin} ${new URL(photosOrigin).origin}; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
