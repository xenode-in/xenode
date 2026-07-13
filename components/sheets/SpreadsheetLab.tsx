"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildCompatibilityReport } from "@/lib/spreadsheets/compatibility";
import { createBlankWorkbook } from "@/lib/spreadsheets/xlsxAdapter";
import { SpreadsheetWorkerClient } from "@/lib/spreadsheets/workerClient";
import type { CompatibilityReport, NormalizedWorkbook } from "@/lib/spreadsheets/types";

const fixtures = ["Simple values", "Common formulas", "Multiple sheets", "Merged cells", "Dates and currencies", "Cell styling", "Hidden rows and columns", "Frozen panes", "Data validation", "Conditional formatting", "Charts and images", "Pivot tables", "Macro-enabled workbook"];
function fixture(name: string): NormalizedWorkbook { const book = createBlankWorkbook(); book.properties.title = name; const sheet = book.sheets[0]; sheet.cells = { 0: { 0: { value: name, type: "string" }, 1: { value: 2, type: "number" } }, 1: { 0: { value: 3, type: "number" }, 1: { value: 5, type: "number", formula: "=SUM(B1,A2)" } } }; sheet.rowCount = 20; sheet.columnCount = 10; if (name === "Merged cells") sheet.merges = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 2 }]; if (name === "Frozen panes") { sheet.frozenRows = 1; sheet.frozenColumns = 1; } if (name === "Hidden rows and columns") { sheet.rows = [{ index: 2, hidden: true }]; sheet.columns = [{ index: 2, hidden: true }]; } return book; }
export function SpreadsheetLab() {
  const [selected, setSelected] = useState(fixtures[0]); const [report, setReport] = useState<CompatibilityReport | null>(null); const [timing, setTiming] = useState("");
  const run = async () => { const worker = new SpreadsheetWorkerClient(); try { const model = fixture(selected); const start = performance.now(); const buffer = await worker.export(model); const exportMs = performance.now() - start; const parseStart = performance.now(); const reopened = await worker.parse(buffer); const parseMs = performance.now() - parseStart; setReport(reopened.compatibility ?? buildCompatibilityReport(reopened.workbook)); setTiming(`Export ${exportMs.toFixed(1)} ms · reopen ${parseMs.toFixed(1)} ms`); } finally { worker.dispose(); } };
  return <main className="h-full overflow-auto p-6 md:p-10"><div className="mx-auto max-w-3xl space-y-6"><div><p className="text-sm text-emerald-500">Development only</p><h1 className="text-2xl font-semibold">Spreadsheet compatibility lab</h1></div><div className="flex gap-2"><Select value={selected} onValueChange={setSelected}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{fixtures.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Button onClick={() => void run()}>Export and reopen</Button></div>{timing && <p className="text-sm">{timing}</p>}{report && <pre className="overflow-auto rounded-lg border bg-muted p-4 text-xs">{JSON.stringify(report, null, 2)}</pre>}</div></main>;
}

