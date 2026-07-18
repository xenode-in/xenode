import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Shared ESLint flat config for Xenode Next.js web apps (Drive, Accounts,
 * photos). Apps import this and append their own app-specific ignores/rules.
 */
export const nextConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export const packageConfig = defineConfig([
  ...nextTs,
  globalIgnores(["dist/**", "build/**", "coverage/**"]),
]);

export default nextConfig;
