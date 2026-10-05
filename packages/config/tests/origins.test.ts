import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerProductOrigin, resolveProductOrigin, validateWebOrigin } from "../src";
import { getPublicProductOrigin, getPublicRealtimeOrigin } from "../src/client";

afterEach(() => vi.unstubAllEnvs());

describe("deployment product origins", () => {
  it("requires explicit production origins and defaults only in development", () => {
    for (const product of ["accounts", "drive", "photos"] as const) {
      expect(() => resolveProductOrigin(product, undefined, "production"))
        .toThrow(`${product.toUpperCase()}_ORIGIN is required`);
      expect(resolveProductOrigin(product, undefined, "development"))
        .toMatch(/^http:\/\/localhost:300[012]$/u);
    }
    expect(resolveProductOrigin("drive", "https://staging.example.test/", "production"))
      .toBe("https://staging.example.test");
  });

  it.each([
    "", "not a url", "javascript:alert(1)", "ftp://drive.example.test",
    "https://drive.example.test/path", "https://drive.example.test/?next=x",
    "https://drive.example.test/#fragment", "https://user:pass@drive.example.test",
    " https://drive.example.test", "https://drive.example.test\\evil",
  ])("refuses malformed or non-origin values: %s", (value) => {
    expect(() => validateWebOrigin(value, "DRIVE_ORIGIN")).toThrow("exact http(s) origin");
  });

  it("uses the server origin for trust checks even when the public alias disagrees", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DRIVE_ORIGIN", "https://configured.example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://obsolete.example.test");
    expect(getServerProductOrigin("drive")).toBe("https://configured.example.test");
  });

  it("requires browser origins and derives realtime from configured Drive", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DRIVE_ORIGIN", undefined);
    vi.stubEnv("NEXT_PUBLIC_REALTIME_ORIGIN", undefined);
    expect(() => getPublicProductOrigin("drive")).toThrow("NEXT_PUBLIC_DRIVE_ORIGIN is required");
    expect(() => getPublicRealtimeOrigin()).toThrow("is required");
    vi.stubEnv("NEXT_PUBLIC_DRIVE_ORIGIN", "https://configured.example.test");
    expect(getPublicProductOrigin("drive")).toBe("https://configured.example.test");
    expect(getPublicRealtimeOrigin()).toBe("https://configured.example.test");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_ORIGIN", "https://realtime.example.test/");
    expect(getPublicRealtimeOrigin()).toBe("https://realtime.example.test");
  });
});
