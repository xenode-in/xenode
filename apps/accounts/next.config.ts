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
};

export default nextConfig;
