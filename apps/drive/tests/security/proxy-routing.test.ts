import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

function request(host: string, pathname: string) {
  return new NextRequest(`https://${host}${pathname}`, {
    headers: { host },
  });
}

describe("proxy office routing", () => {
  it("keeps the configured root Drive host on its own login flow", () => {
    vi.stubEnv("DRIVE_ORIGIN", "https://xenode.in");
    const response = proxy(request("xenode.in", "/dashboard"));
    expect(response.headers.get("location")).toBe("https://xenode.in/auth/login");
  });

  it("checks API origins against DRIVE_ORIGIN even when the public alias differs", () => {
    vi.stubEnv("DRIVE_ORIGIN", "https://configured.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://obsolete.test");
    const apiRequest = (origin: string) => new NextRequest("https://configured.test/api/me", {
      headers: { host: "configured.test", origin },
    });
    expect(proxy(apiRequest("https://configured.test")).status).toBe(200);
    expect(proxy(apiRequest("https://obsolete.test")).status).toBe(403);
  });

  it("allows the canonical Office editor route on the Drive host", () => {
    const response = proxy(request("xenode.in", "/office-editor/editor"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(
      existsSync(
        join(process.cwd(), "app/(office-editor)/office-editor/editor/page.tsx"),
      ),
    ).toBe(true);
  });

  it.each(["sheets-v2.xenode.in", "sheets-v2.localhost:3100"])(
    "retires the %s hostname and route tree",
    async (host) => {
      const response = proxy(request(host, "/editor"));

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not Found");
      expect(
        existsSync(
          join(process.cwd(), "app/(sheets-v2)/sheets-v2/editor/page.tsx"),
        ),
      ).toBe(false);
    },
  );

  it.each(["edit.xenode.in", "preview.xenode.in"])(
    "keeps %s static-only at the application proxy boundary",
    async (host) => {
      const response = proxy(request(host, "/office-editor/editor"));

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not Found");
    },
  );
});
