import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./browser-tests", testMatch: "**/*.pw.ts", fullyParallel: false,
  workers: 1, timeout: 30_000, reporter: "list", use: { headless: true,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined,
    screenshot: "only-on-failure", trace: "retain-on-failure" } });
