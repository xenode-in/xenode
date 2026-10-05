import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Each product's vercel.json is the one schedule contract: Vercel reads it and
// the Docker scheduler (Dockerfile.cron) bakes it in.
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const scheduled = (file: string) =>
  (JSON.parse(readFileSync(`${repo}${file}`, "utf8")).crons as Array<{ path: string }>)
    .map((cron) => cron.path)
    .sort();
const routes = (app: string) =>
  readdirSync(`${repo}apps/${app}/app/api/cron`)
    .filter((name) => name !== "ping")
    .map((name) => `/api/cron/${name}`)
    .sort();

describe("scheduler contract", () => {
  it("schedules every product cron route exactly once", () => {
    expect(scheduled("vercel.json")).toEqual(routes("drive"));
    expect(scheduled("apps/photos/vercel.json")).toEqual(routes("photos"));
  });
});
