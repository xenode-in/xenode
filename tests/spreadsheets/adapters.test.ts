import { describe, expect, it } from "vitest";
import { buildCompatibilityReport } from "@/lib/spreadsheets/compatibility";
import { createBlankWorkbook, normalizedToXlsx, xlsxToNormalized } from "@/lib/spreadsheets/xlsxAdapter";
import { normalizedToUniver, univerToNormalized } from "@/lib/spreadsheets/univerAdapter";

function workbookFixture() {
  const workbook = createBlankWorkbook(); const sheet = workbook.sheets[0];
  sheet.cells = {
    0: { 0: { value: "Revenue", type: "string" }, 1: { value: 12.5, type: "number", numberFormat: "$#,##0.00" } },
    1: { 0: { value: 2, type: "number" }, 1: { value: 14.5, type: "number", formula: "=SUM(B1,A2)" } },
  };
  sheet.rowCount = 2; sheet.columnCount = 2;
  sheet.merges = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }];
  return workbook;
}

describe("spreadsheet adapters", () => {
  it("preserves formulas, merges, and number formats through XLSX", () => {
    const reopened = xlsxToNormalized(normalizedToXlsx(workbookFixture()));
    expect(reopened.sheets[0].cells[1][1].formula).toBe("=SUM(B1,A2)");
    expect(reopened.sheets[0].merges).toEqual([{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }]);
    expect(reopened.sheets[0].cells[0][1].numberFormat).toBe("$#,##0.00");
  });

  it("maps normalized models to Univer snapshots and back", () => {
    const source = workbookFixture(); const reopened = univerToNormalized(normalizedToUniver(source));
    expect(reopened.sheetOrder).toEqual(source.sheetOrder);
    expect(reopened.sheets[0].cells[1][1].formula).toBe("=SUM(B1,A2)");
    expect(reopened.sheets[0].merges).toEqual(source.sheets[0].merges);
  });

  it("flags formulas outside the verified subset", () => {
    const source = workbookFixture(); source.sheets[0].cells[1][1].formula = "=WEBSERVICE(A1)";
    const report = buildCompatibilityReport(source);
    expect(report.hasUnsupportedFeatures).toBe(true);
    expect(report.issues.some((issue) => issue.feature === "unsupported_formulas")).toBe(true);
  });
});

