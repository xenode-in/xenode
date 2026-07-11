import JSZip from "jszip";
import type { CompatibilityIssue, CompatibilityReport, NormalizedWorkbook } from "./types";

const PACKAGE_FEATURES: Array<{ test: RegExp; feature: string; support: CompatibilityIssue["support"]; message: string }> = [
  { test: /^xl\/charts\//m, feature: "charts", support: "not_supported", message: "Charts are displayed without round-trip preservation." },
  { test: /^xl\/drawings\//m, feature: "images_drawings", support: "not_supported", message: "Images and drawings are not preserved by the initial exporter." },
  { test: /^xl\/pivotTables\//m, feature: "pivot_tables", support: "not_supported", message: "Pivot tables are not preserved." },
  { test: /vbaProject\.bin/m, feature: "macros_vba", support: "not_supported", message: "VBA projects are not preserved in XLSX output." },
  { test: /^xl\/externalLinks\//m, feature: "external_links", support: "not_supported", message: "External workbook links may be removed." },
];

export async function inspectSpreadsheetPackage(buffer: ArrayBuffer): Promise<CompatibilityIssue[]> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).join("\n");
    const issues = PACKAGE_FEATURES.filter((entry) => entry.test.test(names)).map(({ feature, support, message }) => ({ feature, support, message }));
    const xmlNames = Object.keys(zip.files).filter((name) => /^xl\/(worksheets|workbook)\/?.*\.xml$/.test(name) || name === "xl/workbook.xml");
    const xml = (await Promise.all(xmlNames.map((name) => zip.file(name)?.async("string") ?? ""))).join("\n");
    if (/<conditionalFormatting\b/.test(xml)) issues.push({ feature: "conditional_formatting", support: "not_supported", message: "Conditional formatting is not preserved." });
    if (/<dataValidation\b/.test(xml)) issues.push({ feature: "data_validation", support: "partially_supported", message: "Advanced data validation may not survive export." });
    if (/<definedName\b/.test(xml)) issues.push({ feature: "named_ranges", support: "partially_supported", message: "Named ranges are not fully editable." });
    if (/<sheetProtection\b/.test(xml)) issues.push({ feature: "protected_sheets", support: "not_supported", message: "Sheet protection is not preserved." });
    return issues;
  } catch {
    return [{ feature: "package_inspection", support: "unknown", message: "The original package could not be inspected for advanced features." }];
  }
}

export function buildCompatibilityReport(workbook: NormalizedWorkbook, packageIssues: CompatibilityIssue[] = []): CompatibilityReport {
  const issues = [...packageIssues];
  for (const sheet of workbook.sheets) {
    for (const row of Object.values(sheet.cells)) for (const cell of Object.values(row)) {
      if (cell.formula && /\b(CUBE|RTD|WEBSERVICE|STOCKHISTORY|LAMBDA|LET)\s*\(/i.test(cell.formula)) {
        issues.push({ feature: "unsupported_formulas", support: "unknown", sheetId: sheet.id, message: "This workbook contains formulas outside the verified formula subset." });
        break;
      }
    }
  }
  const unique = issues.filter((issue, index) => issues.findIndex((other) => other.feature === issue.feature && other.sheetId === issue.sheetId) === index);
  return { issues: unique, warningCount: unique.length, hasUnsupportedFeatures: unique.some((issue) => issue.support !== "fully_supported") };
}

