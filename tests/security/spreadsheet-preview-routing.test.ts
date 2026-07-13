import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("spreadsheet preview routing", () => {
  it("removes every v1 spreadsheet route", () => {
    expect(
      existsSync(join(process.cwd(), "app/(sheets)/sheets/editor/page.tsx")),
    ).toBe(false);
    expect(
      existsSync(join(process.cwd(), "app/(sheets)/sheets/page.tsx")),
    ).toBe(false);
  });

  it("preserves the preview shell without legacy renderer paths", () => {
    const previewContext = read("contexts/PreviewContext.tsx");
    const dialog = read("components/dashboard/FilePreviewDialog.tsx");
    expect(previewContext).not.toContain("/sheets/editor");
    expect(dialog).toContain("ZoomableImage");
    expect(dialog).toContain("SafePdfPreview");
    expect(dialog).toContain("SafeTextPreview");
    expect(dialog).toContain("/sheets-v2/editor");
    expect(dialog).not.toContain("<iframe");
    expect(dialog).not.toContain("<object");
    expect(dialog).not.toContain("<embed");
    expect(dialog).not.toContain("REGISTER_STREAM");
    expect(dialog).not.toContain("/sw/objects/");
    expect(dialog).not.toContain("DocxViewer");
    expect(dialog).not.toContain("DocViewer");
    expect(dialog).not.toContain("view.officeapps.live.com");
    expect(dialog).not.toContain("/sheets/editor");
    expect(dialog).not.toContain("docs.xenode.in");
  });

  it("uses original MIME metadata for HD image upgrades", () => {
    const dialog = read("components/dashboard/FilePreviewDialog.tsx");
    const hdStart = dialog.indexOf("HD / original-quality loader");
    const hdEnd = dialog.indexOf("if (!file) return null;", hdStart);
    const hdLoader = dialog.slice(hdStart, hdEnd);

    expect(hdStart).toBeGreaterThanOrEqual(0);
    expect(hdEnd).toBeGreaterThan(hdStart);
    expect(hdLoader).toContain("data.encryptedContentType");
    expect(hdLoader).toContain("activeMetadataKey");
    expect(hdLoader).toContain("decryptMetadataString");
    expect(hdLoader).toContain("originalName,");
    expect(hdLoader).toContain("data.chunkUrls");
    expect(hdLoader).not.toContain("decryptedContentType || data.contentType");
  });

  it("retains the isolated OnlyOffice v2 route", () => {
    expect(
      existsSync(
        join(process.cwd(), "app/(sheets-v2)/sheets-v2/editor/page.tsx"),
      ),
    ).toBe(true);
  });
});
