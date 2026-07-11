/* eslint-disable @typescript-eslint/no-explicit-any */
import * as XLSX from "xlsx";
import { SPREADSHEET_SCHEMA_VERSION, type NormalizedCell, type NormalizedCellStyle, type NormalizedWorkbook, type NormalizedWorksheet } from "./types";

type StyledCell = XLSX.CellObject & { s?: Record<string, any> };
type ExtendedSheet = XLSX.WorkSheet & { "!rows"?: Array<{ hpx?: number; hpt?: number; hidden?: boolean }>; "!cols"?: Array<{ wpx?: number; width?: number; hidden?: boolean }>; "!freeze"?: { xSplit?: number; ySplit?: number } };

function stableId(prefix: string, value: string, index: number): string {
  let hash = 2166136261;
  for (const char of `${value}:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}
function normalizedType(cell: XLSX.CellObject): NormalizedCell["type"] {
  if (cell.v == null) return "blank";
  if (cell.t === "n") return cell.v instanceof Date ? "date" : "number";
  if (cell.t === "b") return "boolean";
  if (cell.t === "e") return "error";
  if (cell.t === "d") return "date";
  return "string";
}
function color(value: any) { return value ? { rgb: value.rgb, theme: value.theme, tint: value.tint } : undefined; }
function style(cell: StyledCell): NormalizedCellStyle | undefined {
  const s = cell.s;
  if (!s) return undefined;
  return {
    font: s.font && { name: s.font.name, size: s.font.sz, bold: s.font.bold, italic: s.font.italic, underline: !!s.font.underline, strike: s.font.strike, color: color(s.font.color) },
    fill: s.fill && { pattern: s.fill.patternType, foreground: color(s.fill.fgColor), background: color(s.fill.bgColor) },
    border: s.border && Object.fromEntries(Object.entries(s.border).map(([key, side]: [string, any]) => [key, { style: side?.style, color: color(side?.color) }])),
    horizontal: s.alignment?.horizontal,
    vertical: s.alignment?.vertical === "center" ? "middle" : s.alignment?.vertical,
    wrapText: s.alignment?.wrapText,
  };
}

export function xlsxToNormalized(buffer: ArrayBuffer): NormalizedWorkbook {
  const source = XLSX.read(buffer, { type: "array", cellDates: true, cellStyles: true, cellFormula: true, bookVBA: true });
  const workbookId = stableId("workbook", source.Props?.Title ?? "workbook", source.SheetNames.length);
  const sheets: NormalizedWorksheet[] = source.SheetNames.map((name, order) => {
    const ws = source.Sheets[name] as ExtendedSheet;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    const cells: NormalizedWorksheet["cells"] = {};
    for (let row = range.s.r; row <= range.e.r; row++) for (let column = range.s.c; column <= range.e.c; column++) {
      const sourceCell = ws[XLSX.utils.encode_cell({ r: row, c: column })] as StyledCell | undefined;
      if (!sourceCell) continue;
      const value = sourceCell.v instanceof Date ? sourceCell.v.toISOString() : (sourceCell.v as NormalizedCell["value"]);
      (cells[row] ??= {})[column] = { value, type: normalizedType(sourceCell), formula: sourceCell.f ? `=${sourceCell.f}` : undefined, numberFormat: sourceCell.z == null ? undefined : String(sourceCell.z), style: style(sourceCell) };
    }
    const sheetMeta = source.Workbook?.Sheets?.[order] as { Hidden?: number } | undefined;
    return {
      id: stableId("sheet", name, order), name, order,
      rowCount: range.e.r + 1, columnCount: range.e.c + 1, cells,
      merges: (ws["!merges"] ?? []).map((merge) => ({ startRow: merge.s.r, startColumn: merge.s.c, endRow: merge.e.r, endColumn: merge.e.c })),
      rows: (ws["!rows"] ?? []).flatMap((entry, index) => entry ? [{ index, size: entry.hpx ?? (entry.hpt ? entry.hpt * 96 / 72 : undefined), hidden: entry.hidden }] : []),
      columns: (ws["!cols"] ?? []).flatMap((entry, index) => entry ? [{ index, size: entry.wpx ?? (entry.width ? entry.width * 7 : undefined), hidden: entry.hidden }] : []),
      frozenRows: ws["!freeze"]?.ySplit ?? 0, frozenColumns: ws["!freeze"]?.xSplit ?? 0,
      hidden: !!sheetMeta?.Hidden,
    };
  });
  return {
    schemaVersion: SPREADSHEET_SCHEMA_VERSION,
    id: workbookId,
    properties: { title: source.Props?.Title, subject: source.Props?.Subject, author: source.Props?.Author, company: source.Props?.Company, createdAt: source.Props?.CreatedDate?.toISOString(), modifiedAt: source.Props?.ModifiedDate?.toISOString() },
    sheetOrder: sheets.map((sheet) => sheet.id), sheets,
  };
}

function xlsxCell(cell: NormalizedCell): StyledCell {
  const formula = cell.formula?.replace(/^=/, "");
  const output: StyledCell = { t: cell.type === "number" || cell.type === "date" ? "n" : cell.type === "boolean" ? "b" : cell.type === "error" ? "e" : "s", v: cell.value ?? "" };
  if (cell.type === "date" && typeof cell.value === "string") { output.t = "d"; output.v = new Date(cell.value); }
  if (formula) output.f = formula;
  if (cell.numberFormat) output.z = cell.numberFormat;
  return output;
}

export function normalizedToXlsx(workbook: NormalizedWorkbook): ArrayBuffer {
  const target = XLSX.utils.book_new();
  target.Props = { Title: workbook.properties.title, Subject: workbook.properties.subject, Author: workbook.properties.author, Company: workbook.properties.company };
  for (const sheet of [...workbook.sheets].sort((a, b) => a.order - b.order)) {
    const ws: ExtendedSheet = {};
    for (const [row, columns] of Object.entries(sheet.cells)) for (const [column, cell] of Object.entries(columns)) ws[XLSX.utils.encode_cell({ r: Number(row), c: Number(column) })] = xlsxCell(cell);
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, sheet.rowCount - 1), c: Math.max(0, sheet.columnCount - 1) } });
    ws["!merges"] = sheet.merges.map((merge) => ({ s: { r: merge.startRow, c: merge.startColumn }, e: { r: merge.endRow, c: merge.endColumn } }));
    ws["!rows"] = []; for (const row of sheet.rows) ws["!rows"]![row.index] = { hpx: row.size, hidden: row.hidden };
    ws["!cols"] = []; for (const column of sheet.columns) ws["!cols"]![column.index] = { wpx: column.size, hidden: column.hidden };
    if (sheet.frozenRows || sheet.frozenColumns) ws["!freeze"] = { ySplit: sheet.frozenRows, xSplit: sheet.frozenColumns };
    XLSX.utils.book_append_sheet(target, ws, sheet.name.slice(0, 31));
  }
  target.Workbook ??= {}; target.Workbook.Sheets = workbook.sheets.map((sheet) => ({ Hidden: sheet.hidden ? 1 : 0 }));
  return XLSX.write(target, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;
}

export function createBlankWorkbook(): NormalizedWorkbook {
  const sheet: NormalizedWorksheet = { id: "sheet_1", name: "Sheet1", order: 0, rowCount: 1000, columnCount: 26, cells: {}, merges: [], rows: [], columns: Array.from({ length: 26 }, (_, index) => ({ index, size: 100 })), frozenRows: 0, frozenColumns: 0, hidden: false };
  return { schemaVersion: 1, id: crypto.randomUUID(), properties: { title: "Untitled spreadsheet" }, sheetOrder: [sheet.id], sheets: [sheet] };
}

