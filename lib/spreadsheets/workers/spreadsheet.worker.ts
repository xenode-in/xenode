/// <reference lib="webworker" />
import { buildCompatibilityReport, inspectSpreadsheetPackage } from "../compatibility";
import type { NormalizedWorkbook, SpreadsheetExportFormat } from "../types";
import { normalizedToSpreadsheetFile, xlsxToNormalized } from "../xlsxAdapter";

type Request = { id: string; type: "parse"; buffer: ArrayBuffer } | { id: string; type: "export"; workbook: NormalizedWorkbook; format?: SpreadsheetExportFormat };

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "parse") {
      const inspectionBuffer = request.buffer.slice(0);
      const [workbook, packageIssues] = await Promise.all([
        Promise.resolve(xlsxToNormalized(request.buffer)),
        inspectSpreadsheetPackage(inspectionBuffer),
      ]);
      self.postMessage({ id: request.id, ok: true, workbook, compatibility: buildCompatibilityReport(workbook, packageIssues) });
      return;
    }
    const buffer = normalizedToSpreadsheetFile(request.workbook, request.format ?? "xlsx");
    self.postMessage({ id: request.id, ok: true, buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "spreadsheet_worker_failed" });
  }
};

export {};

