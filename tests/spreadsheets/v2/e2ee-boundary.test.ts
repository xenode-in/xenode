import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Sheets v2 E2EE boundary", () => {
  it("binary persistence uploads AES-GCM ciphertext, never plaintext bytes", () => {
    for (const file of [
      "lib/spreadsheets/v2/persistence.ts",
      "lib/spreadsheets/v2/sharePersistence.ts",
    ]) {
      const src = read(file);
      expect(src).toContain("encryptFileWithDEK");
      expect(src).toMatch(/body: ciphertext/);
      // The raw workbook bytes must never be posted directly.
      expect(src).not.toMatch(/body:\s*input\.bytes/);
    }
  });

  it("recovery snapshots are encrypted before hitting the v2 Dexie store", () => {
    const recovery = read("lib/spreadsheets/v2/recovery.ts");
    const db = read("lib/db/local.ts");
    expect(recovery).toContain('crypto.subtle.encrypt(\n    { name: "AES-GCM"');
    expect(db).toContain("SpreadsheetV2DraftRecord");
    expect(db).toContain("ciphertext: Blob");
    // v2 drafts store opaque bytes, never a normalized workbook object.
    expect(db).not.toMatch(/interface SpreadsheetV2DraftRecord[\s\S]*workbook:/);
  });

  it("the frame host targets an exact parent origin, never a wildcard", () => {
    const frame = read("tools/onlyoffice/host/xenode-frame.js");
    expect(frame).toContain("parent.postMessage(envelope(body, requestId), PARENT_ORIGIN");
    expect(frame).not.toMatch(/postMessage\([^,]+,\s*["']\*["']/);
    // Inbound messages are origin- and source-checked.
    expect(frame).toContain("event.origin !== PARENT_ORIGIN");
    expect(frame).toContain("event.source !== window.parent");
  });

  it("the parent bridge validates origin + source and never posts to '*'", () => {
    const bridge = read("lib/spreadsheets/v2/bridge/parentBridge.ts");
    expect(bridge).toContain("event.origin !== this.editorOrigin");
    expect(bridge).toContain("event.source !== this.frame.contentWindow");
    expect(bridge).toContain("target.postMessage(message, this.editorOrigin, transfer)");
    expect(bridge).not.toMatch(/postMessage\([^,]+,\s*["']\*["']/);
  });

  it("the editor artifact CSP forbids network egress from the iframe", () => {
    const config = read("next.config.ts");
    // connect-src 'none' on the editor origin keeps the iframe from phoning home.
    expect(config).toMatch(/internal-editors\/onlyoffice[\s\S]*connect-src 'none'/);
  });
});
