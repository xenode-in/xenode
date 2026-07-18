import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("spreadsheet E2EE boundary", () => {
  it("keeps workbook libraries and parsing out of server routes", () => {
    const routeSources = [
      "app/api/objects/[id]/route.ts",
      "app/api/objects/[id]/content/route.ts",
      "app/api/objects/[id]/update-content/route.ts",
      "app/api/direct-shares/[id]/update-content/route.ts",
      "lib/storage/applyContentUpdate.ts",
    ].map(read).join("\n");
    expect(routeSources).not.toMatch(/from ["']xlsx["']/);
    expect(routeSources).not.toMatch(/@univerjs/);
    expect(routeSources).not.toMatch(/Workbook JSON|cell values|sheet names/i);
  });

  it("atomically rejects stale saves with 409", () => {
    const helper = read("lib/storage/applyContentUpdate.ts");
    expect(helper).toContain("revisionFilter(expectedRevision)");
    expect(helper).toContain("update.matchedCount !== 1");
    const ownerRoute = read("app/api/objects/[id]/update-content/route.ts");
    const shareRoute = read("app/api/direct-shares/[id]/update-content/route.ts");
    for (const route of [ownerRoute, shareRoute]) {
      expect(route).toContain("applyContentUpdate");
      expect(route).toContain("{ status: 409 }");
    }
  });

  it("share saves require the editor role", () => {
    const shareRoute = read("app/api/direct-shares/[id]/update-content/route.ts");
    expect(shareRoute).toContain("canEdit(normalizeShareRole(recipient.accessType))");
    expect(shareRoute).toContain("edit_forbidden");
  });
});

