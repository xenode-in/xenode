import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { getTimelineWindow } from "../lib/virtual-timeline";
import {
  decryptPhotoFile,
  encryptPhotoFile,
} from "../lib/photo-encryption";
import { fitImageWithin } from "../lib/image-derivatives";

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

  it("does not import Drive internals", () => {
    const source = [
      ...sourceFiles(join(process.cwd(), "app")),
      ...sourceFiles(join(process.cwd(), "lib")),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/apps\/drive|dashboard\/photos|@\/contexts\/CryptoContext/u);
  });

  it("encrypts photo bytes with a per-file key wrapped by the Photos Space key", async () => {
    const rawProductKey = crypto.getRandomValues(new Uint8Array(32));
    const productKey = await crypto.subtle.importKey(
      "raw",
      rawProductKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    rawProductKey.fill(0);
    const context = {
      accountId: "account_1",
      spaceId: "space_personal_account_1",
      objectKey: "users/account_1/0123456789abcdef0123456789abcdef",
    };
    const encrypted = await encryptPhotoFile(
      new Blob(["private-photo-bytes"]),
      productKey,
      context,
    );
    expect(encrypted.body.byteLength).toBe(
      Buffer.byteLength("private-photo-bytes") + 16,
    );
    const plaintext = await decryptPhotoFile(
      encrypted.body,
      productKey,
      context,
      encrypted,
    );
    expect(new TextDecoder().decode(plaintext)).toBe("private-photo-bytes");
  });

  it("bounds thumbnail and optimized dimensions without upscaling", () => {
    expect(fitImageWithin(6000, 4000, 512)).toEqual({
      width: 512,
      height: 341,
    });
    expect(fitImageWithin(6000, 4000, 2560)).toEqual({
      width: 2560,
      height: 1707,
    });
    expect(fitImageWithin(320, 240, 512)).toEqual({
      width: 320,
      height: 240,
    });
  });
});
