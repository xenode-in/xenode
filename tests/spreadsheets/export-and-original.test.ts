import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IStorageObjectVersion } from "@/models/StorageObject";
import { evictOverflow } from "@/lib/storage/versions";
import {
  createBlankWorkbook,
  normalizedToSpreadsheetFile,
} from "@/lib/spreadsheets/xlsxAdapter";
import type { SpreadsheetExportFormat } from "@/lib/spreadsheets/types";

function version(index: number, isOriginal = false): IStorageObjectVersion {
  return {
    versionId: `version-${index}`,
    isOriginal,
    key: `users/u/cipher-${index}`,
    b2FileId: `b2-${index}`,
    size: 100 + index,
    createdAt: new Date(index * 1_000),
    createdBy: "u",
  };
}

describe("spreadsheet exports and immutable originals", () => {
  it.each<SpreadsheetExportFormat>(["xlsx", "xls", "csv", "tsv", "ods"])(
    "exports %s locally",
    (format) => {
      const workbook = createBlankWorkbook();
      workbook.sheets[0].cells = {
        0: { 0: { value: "Revenue", type: "string" } },
      };
      const output = normalizedToSpreadsheetFile(workbook, format);
      expect(output.byteLength).toBeGreaterThan(10);
      if (format === "csv" || format === "tsv") {
        expect(new TextDecoder().decode(output)).toContain("Revenue");
      }
    },
  );

  it("pins the original while evicting old rolling versions", () => {
    const original = version(0, true);
    const rolling = Array.from({ length: 11 }, (_, index) => version(index + 1));
    const result = evictOverflow([...rolling, original]);

    expect(result.kept).toHaveLength(10);
    expect(result.kept.at(-1)).toBe(original);
    expect(result.evicted).toHaveLength(2);
    expect(result.evicted).not.toContain(original);
  });

  it("protects the original at API and UI boundaries", () => {
    const root = process.cwd();
    const deleteRoute = readFileSync(
      join(root, "app/api/objects/[id]/versions/[versionId]/route.ts"),
      "utf8",
    );
    const dialog = readFileSync(
      join(root, "components/dashboard/FileVersionsDialog.tsx"),
      "utf8",
    );

    expect(deleteRoute).toContain("original_version_protected");
    expect(dialog).toContain("!v.isOriginal");
  });
});
