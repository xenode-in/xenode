/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NormalizedCell, NormalizedCellStyle, NormalizedWorkbook } from "./types";

export interface UniverWorkbookData { id: string; name: string; appVersion: string; locale: string; styles: Record<string, unknown>; sheetOrder: string[]; sheets: Record<string, any> }

function univerStyle(style?: NormalizedCellStyle): Record<string, unknown> | undefined {
  if (!style) return undefined;
  return { ff: style.font?.name, fs: style.font?.size, bl: style.font?.bold ? 1 : 0, it: style.font?.italic ? 1 : 0, ul: style.font?.underline ? 1 : 0, st: style.font?.strike ? 1 : 0, cl: style.font?.color?.rgb ? { rgb: style.font.color.rgb } : undefined, bg: style.fill?.foreground?.rgb ? { rgb: style.fill.foreground.rgb } : undefined, ht: style.horizontal, vt: style.vertical === "middle" ? "middle" : style.vertical, tb: style.wrapText ? 1 : 0 };
}
function univerCell(cell: NormalizedCell): Record<string, unknown> {
  return { v: cell.value, f: cell.formula, t: cell.type === "number" || cell.type === "date" ? 2 : cell.type === "boolean" ? 3 : 1, s: univerStyle(cell.style), n: cell.numberFormat ? { pattern: cell.numberFormat } : undefined };
}

export function normalizedToUniver(workbook: NormalizedWorkbook): UniverWorkbookData {
  return {
    id: workbook.id, name: workbook.properties.title ?? "Spreadsheet", appVersion: "1.0.0", locale: "enUS", styles: {}, sheetOrder: workbook.sheetOrder,
    sheets: Object.fromEntries(workbook.sheets.map((sheet) => [sheet.id, {
      id: sheet.id, name: sheet.name, tabColor: "", hidden: sheet.hidden ? 1 : 0, rowCount: sheet.rowCount, columnCount: sheet.columnCount,
      cellData: Object.fromEntries(Object.entries(sheet.cells).map(([row, columns]) => [row, Object.fromEntries(Object.entries(columns).map(([column, cell]) => [column, univerCell(cell)]))])),
      mergeData: sheet.merges.map((merge) => ({ startRow: merge.startRow, startColumn: merge.startColumn, endRow: merge.endRow, endColumn: merge.endColumn })),
      rowData: Object.fromEntries(sheet.rows.map((row) => [row.index, { h: row.size, hd: row.hidden ? 1 : 0 }])),
      columnData: Object.fromEntries(sheet.columns.map((column) => [column.index, { w: column.size, hd: column.hidden ? 1 : 0 }])),
      freeze: { startRow: sheet.frozenRows, startColumn: sheet.frozenColumns, xSplit: sheet.frozenColumns, ySplit: sheet.frozenRows }, showGridlines: 1,
    }])),
  };
}

export function univerToNormalized(snapshot: UniverWorkbookData): NormalizedWorkbook {
  const sheets = snapshot.sheetOrder.map((id, order) => {
    const sheet = snapshot.sheets[id];
    const cells: any = {};
    for (const [row, columns] of Object.entries(sheet.cellData ?? {})) for (const [column, raw] of Object.entries(columns as Record<string, any>)) {
      const cell = raw as any; (cells[Number(row)] ??= {})[Number(column)] = { value: cell.v ?? null, formula: cell.f, type: cell.t === 2 ? "number" : cell.t === 3 ? "boolean" : "string", numberFormat: cell.n?.pattern };
    }
    return { id, name: sheet.name, order, rowCount: sheet.rowCount, columnCount: sheet.columnCount, cells, merges: sheet.mergeData ?? [], rows: Object.entries(sheet.rowData ?? {}).map(([index, row]: [string, any]) => ({ index: Number(index), size: row.h, hidden: !!row.hd })), columns: Object.entries(sheet.columnData ?? {}).map(([index, column]: [string, any]) => ({ index: Number(index), size: column.w, hidden: !!column.hd })), frozenRows: sheet.freeze?.ySplit ?? 0, frozenColumns: sheet.freeze?.xSplit ?? 0, hidden: !!sheet.hidden };
  });
  return { schemaVersion: 1, id: snapshot.id, properties: { title: snapshot.name }, sheetOrder: snapshot.sheetOrder, sheets };
}

