import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
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

  it("allows exactly the configured storage and realtime origins", async () => {
    vi.stubEnv("ACCOUNTS_ORIGIN", "https://accounts.example.test");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_ORIGIN", "https://drive.example.test");
    vi.stubEnv("S3_ENDPOINT", "https://asia-acct.r2.cloudflarestorage.com");
    vi.stubEnv("S3_US_ENDPOINT", "");
    vi.stubEnv("S3_EU_ENDPOINT", "https://eu-acct.eu.r2.cloudflarestorage.com/");
    try {
      const rules = await nextConfig.headers?.();
      const csp = rules?.[0]?.headers.find((header) => header.key === "Content-Security-Policy");
      const connectSrc = /connect-src ([^;]+)/u.exec(csp?.value ?? "")?.[1].split(" ");
      expect(connectSrc).toEqual([
        "'self'",
        "https://accounts.example.test",
        "wss://drive.example.test",
        "https://asia-acct.r2.cloudflarestorage.com",
        "https://eu-acct.eu.r2.cloudflarestorage.com",
      ]);
      expect(csp?.value).not.toMatch(/\*/u);
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("uses the shared preview dialog shell with Drive-style image controls", () => {
    const lightbox = readFileSync(
      join(process.cwd(), "app", "components", "Lightbox.tsx"),
      "utf8",
    );
    expect(lightbox).toContain("<Dialog");
    expect(lightbox).toContain("<DialogContent");
    expect(lightbox).toContain('modal={false}');
    expect(lightbox).toContain('aria-label="Toggle Minimize"');
    expect(lightbox).toContain("function ZoomablePhoto");
    expect(lightbox).toContain("double-click to reset");
    expect(lightbox).toContain("createPortal(");
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
