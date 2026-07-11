import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("spreadsheet preview routing", () => {
  it("opens owned Excel files in Xenode Sheets", () => {
    const previewContext = read("contexts/PreviewContext.tsx");
    expect(previewContext).toContain('file.mediaCategory === "excel"');
    expect(previewContext).toContain('window.location.assign("/sheets/editor?"');
    expect(previewContext).toContain('params.set("orgId", scope.orgId)');
  });

  it("does not send spreadsheet previews to an external Office viewer", () => {
    const dialog = read("components/dashboard/FilePreviewDialog.tsx");
    expect(dialog).not.toContain("view.officeapps.live.com");
    expect(dialog).toContain("Open with Xenode Sheets");
    expect(dialog).toContain("Xenode never sends it to Microsoft Office viewers.");
  });
});
