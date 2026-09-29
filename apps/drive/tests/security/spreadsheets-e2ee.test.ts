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
      "lib/storage/revision-upload.ts",
    ].map(read).join("\n");
    expect(routeSources).not.toMatch(/from ["']xlsx["']/);
    expect(routeSources).not.toMatch(/@univerjs/);
    expect(routeSources).not.toMatch(/Workbook JSON|cell values|sheet names/i);
  });

  it("keeps file bytes out of revision control handlers", () => {
    const helper = read("lib/storage/revision-upload.ts");
    expect(helper).not.toContain("request.arrayBuffer");
    expect(helper).toContain("HeadObjectCommand");
    expect(helper).toContain("commitDriveRevision");
    expect(read("app/api/objects/[id]/update-content/route.ts")).not.toContain("getUploadUrl");
  });

  it("share saves require the editor role", () => {
    const shareRoute = read("app/api/direct-shares/[id]/update-content/route.ts");
    expect(shareRoute).toContain("canEdit(normalizeShareRole(recipient.accessType))");
    expect(shareRoute).toContain("edit_forbidden");
  });
});

