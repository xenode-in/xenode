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
    ].map(read).join("\n");
    expect(routeSources).not.toMatch(/from ["']xlsx["']/);
    expect(routeSources).not.toMatch(/@univerjs/);
    expect(routeSources).not.toMatch(/Workbook JSON|cell values|sheet names/i);
  });

  it("uploads only AES-GCM ciphertext and never the normalized model", () => {
    const persistence = read("lib/spreadsheets/persistence.ts");
    expect(persistence).toContain("encryptFileWithDEK");
    expect(persistence).toMatch(/body: ciphertext/);
    expect(persistence).not.toMatch(/body:\s*JSON\.stringify\(input\.workbook/);
  });

  it("stores recovery drafts in the ciphertext-only Dexie table", () => {
    const recovery = read("lib/spreadsheets/recovery.ts"); const db = read("lib/db/local.ts");
    expect(recovery).toContain('crypto.subtle.encrypt({ name: "AES-GCM"');
    expect(db).toContain("ciphertext: Blob");
    expect(db).not.toMatch(/interface SpreadsheetDraftRecord[\s\S]*workbook:/);
  });

  it("atomically rejects stale saves with 409", () => {
    const route = read("app/api/objects/[id]/update-content/route.ts");
    expect(route).toContain("revisionFilter(expectedRevision)");
    expect(route).toContain("update.matchedCount !== 1");
    expect(route).toContain("{ status: 409 }");
  });
});

