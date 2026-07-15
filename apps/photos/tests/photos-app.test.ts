import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { getTimelineWindow } from "../lib/virtual-timeline";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe("Photos app isolation", () => {
  it("renders a bounded window for tens of thousands of assets", () => {
    const window = getTimelineWindow({
      itemCount: 50_000,
      scrollTop: 400_000,
      viewportHeight: 620,
      columns: 6,
      rowHeight: 152,
    });
    expect(window.totalRows).toBeGreaterThan(8_000);
    expect(window.endIndex - window.startIndex).toBeLessThanOrEqual(66);
  });

  it("keeps a strict per-app CSP without SharedArrayBuffer isolation", async () => {
    const rules = await nextConfig.headers?.();
    const headers = rules?.[0]?.headers ?? [];
    const csp = headers.find((header) => header.key === "Content-Security-Policy");
    const coop = headers.find(
      (header) => header.key === "Cross-Origin-Opener-Policy",
    );
    expect(csp?.value).toContain("frame-ancestors 'none'");
    expect(coop?.value).toBe("same-origin");
    expect(headers.some((header) => header.key === "Cross-Origin-Embedder-Policy")).toBe(false);
    const source = sourceFiles(join(process.cwd(), "app"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toContain("SharedArrayBuffer");
  });

  it("does not import Drive or platform-web internals", () => {
    const source = [
      ...sourceFiles(join(process.cwd(), "app")),
      ...sourceFiles(join(process.cwd(), "lib")),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/platform-web|dashboard\/photos|@\/contexts\/CryptoContext/u);
  });
});
