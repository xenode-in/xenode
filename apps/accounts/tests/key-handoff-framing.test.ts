import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const previousDriveOrigin = process.env.DRIVE_ORIGIN;
const previousPhotosOrigin = process.env.PHOTOS_ORIGIN;

function request(search: URLSearchParams): NextRequest {
  return new NextRequest(
    `http://localhost:3001/security/key-handoff?${search.toString()}`,
  );
}

function brokerParams(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    mode: "iframe",
    clientId: "xenode-drive-web",
    productId: "drive",
    destinationOrigin: "http://localhost:3000",
    ...overrides,
  });
}

describe("key-handoff broker framing policy", () => {
  beforeEach(() => {
    process.env.DRIVE_ORIGIN = "http://localhost:3000";
    process.env.PHOTOS_ORIGIN = "http://localhost:3002";
  });

  afterEach(() => {
    if (previousDriveOrigin === undefined) delete process.env.DRIVE_ORIGIN;
    else process.env.DRIVE_ORIGIN = previousDriveOrigin;
    if (previousPhotosOrigin === undefined) delete process.env.PHOTOS_ORIGIN;
    else process.env.PHOTOS_ORIGIN = previousPhotosOrigin;
  });

  it("allows only the registered product origin to frame iframe handoffs", () => {
    const response = proxy(request(brokerParams()));
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors http://localhost:3000",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["redirect transport", { mode: "redirect" }],
    ["spoofed origin", { destinationOrigin: "https://attacker.example" }],
    ["mismatched product", { productId: "photos" }],
    ["mismatched client", { clientId: "xenode-photos-web" }],
  ])("denies framing for %s", (_label, overrides) => {
    const response = proxy(request(brokerParams(overrides)));
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
});
