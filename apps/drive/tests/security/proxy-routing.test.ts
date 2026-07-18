import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function request(host: string, pathname: string) {
  return new NextRequest(`https://${host}${pathname}`, {
    headers: { host },
  });
}

describe("proxy office routing", () => {
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
