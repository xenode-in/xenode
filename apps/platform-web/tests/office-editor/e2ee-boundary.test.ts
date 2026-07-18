import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
// Normalize CRLF→LF so assertions on multi-line snippets hold on Windows
// checkouts (core.autocrlf) as well as LF.
const readFile = (base: string, path: string) =>
  readFileSync(join(base, path), "utf8").replace(/\r\n/g, "\n");
const read = (path: string) => readFile(root, path);
// ONLYOFFICE build tooling lives at the monorepo root (see CLAUDE.md), not
// inside apps/platform-web, so resolve `tools/**` two levels up from cwd.
const repoRoot = join(root, "..", "..");
const readRepo = (path: string) => readFile(repoRoot, path);

describe("Office editor E2EE boundary", () => {
  it("binary persistence uploads AES-GCM ciphertext, never plaintext bytes", () => {
    for (const file of [
      "lib/office-editor/persistence.ts",
      "lib/office-editor/sharePersistence.ts",
    ]) {
      const src = read(file);
      expect(src).toContain("encryptFileWithDEK");
      expect(src).toMatch(/body: ciphertext/);
      // The raw workbook bytes must never be posted directly.
      expect(src).not.toMatch(/body:\s*input\.bytes/);
    }
  });

  it("recovery snapshots are encrypted before hitting the v2 Dexie store", () => {
    const recovery = read("lib/office-editor/recovery.ts");
    const db = read("lib/db/local.ts");
    expect(recovery).toContain('crypto.subtle.encrypt(\n    { name: "AES-GCM"');
    expect(db).toContain("SpreadsheetV2DraftRecord");
    expect(db).toContain("ciphertext: Blob");
    // v2 drafts store opaque bytes, never a normalized workbook object.
    expect(db).not.toMatch(/interface SpreadsheetV2DraftRecord[\s\S]*workbook:/);
  });

  it("the frame host targets an exact parent origin, never a wildcard", () => {
    const frame = readRepo("tools/onlyoffice/host/xenode-frame.js");
    expect(frame).toContain("parent.postMessage(envelope(body, requestId), PARENT_ORIGIN");
    expect(frame).not.toMatch(/postMessage\([^,]+,\s*["']\*["']/);
    // Inbound messages are origin- and source-checked.
    expect(frame).toContain("event.origin !== PARENT_ORIGIN");
    expect(frame).toContain("event.source !== window.parent");
    // Saves must serialize Editor.bin from the in-browser model. Calling
    // asc_Save would fall back to the absent server /downloadas service.
    expect(frame).toContain("api.asc_nativeGetFile()");
    expect(frame).not.toContain("api.asc_Save()");
    expect(frame).toContain('callbacks.onSave(buffer, "editor-bin", resolvedRequestId)');
    expect(frame).toContain("api.asc_Save = function (isAutoSave)");
    expect(frame).toContain("if (isAutoSave === true || !dirty || activeSave) return true");
    expect(frame).toContain('case "SAVE_RESULT"');
    expect(frame).toContain("savedGeneration === changeGeneration");
    expect(frame).not.toContain("onSaveDocument: handleSavedDocument");
  });

  it("the parent bridge validates origin + source and never posts to '*'", () => {
    const bridge = read("lib/office-editor/bridge/parentBridge.ts");
    expect(bridge).toContain("event.origin !== this.editorOrigin");
    expect(bridge).toContain("event.source !== this.frame.contentWindow");
    expect(bridge).toContain("target.postMessage(message, this.editorOrigin, transfer)");
    expect(bridge).not.toMatch(/postMessage\([^,]+,\s*["']\*["']/);
  });

  it("the editor artifact CSP forbids network egress from the iframe", () => {
    const config = read("next.config.ts");
    // The editor origin's connect-src is limited to same-origin + local blobs
    // (server-less editing fetches the document as a blob URL). Crucially it
    // lists NO external http(s) host, so the iframe still cannot phone home.
    const connectSrc = config.match(
      /internal-editors\/onlyoffice[\s\S]*?connect-src ([^;]+);/,
    )?.[1];
    expect(connectSrc).toBeDefined();
    expect(connectSrc).not.toMatch(/https?:\/\//);
    expect(connectSrc).toMatch(/^'self'(?:\s+(?:blob:|data:))*\s*$/);
  });
});
