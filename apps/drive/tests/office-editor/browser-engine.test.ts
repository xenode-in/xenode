import { describe, expect, it } from "vitest";
import { resolveX2tScriptUrl } from "@/lib/office-editor/conversion/browserEngine";

describe("browser x2t script URL", () => {
  it.each([
    "http://localhost:3000/office-editor",
    "https://xenode.in/office-editor/workbook/demo",
  ])("resolves an absolute URL from %s", (baseUrl) => {
    const resolved = resolveX2tScriptUrl(baseUrl);
    const url = new URL(resolved);

    expect(url.origin).toBe("https://edit.xenode.in");
    expect(url.pathname).toMatch(
      /^\/onlyoffice\/[^/]+\/x2t\/x2t\.js$/,
    );
  });
});
