export const SPREADSHEET_SCHEMA_VERSION = 1;
export const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);
export const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);

export type SpreadsheetExportFormat = "xlsx" | "xls" | "csv" | "tsv" | "ods";

export type SpreadsheetWorkspace =
  | { type: "personal"; workspaceId: string }
  | { type: "organization"; workspaceId: string; organizationId: string }
  | { type: "team"; workspaceId: string; organizationId: string; teamId: string };

export type NormalizedCellValue = string | number | boolean | null;
export type NormalizedCellType = "string" | "number" | "boolean" | "date" | "error" | "blank";

export interface NormalizedColor { rgb?: string; theme?: number; tint?: number }
export interface NormalizedBorderSide { style?: string; color?: NormalizedColor }
export interface NormalizedCellStyle {
  font?: { name?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: NormalizedColor };
  fill?: { pattern?: string; foreground?: NormalizedColor; background?: NormalizedColor };
  border?: { top?: NormalizedBorderSide; right?: NormalizedBorderSide; bottom?: NormalizedBorderSide; left?: NormalizedBorderSide };
  horizontal?: "left" | "center" | "right" | "justify";
  vertical?: "top" | "middle" | "bottom";
  wrapText?: boolean;
}

export interface NormalizedCell {
  value: NormalizedCellValue;
  type: NormalizedCellType;
  formula?: string;
  numberFormat?: string;
  style?: NormalizedCellStyle;
}
export interface NormalizedRange { startRow: number; startColumn: number; endRow: number; endColumn: number }
export interface NormalizedDimension { index: number; size?: number; hidden?: boolean }
export interface NormalizedWorksheet {
  id: string;
  name: string;
  order: number;
  rowCount: number;
  columnCount: number;
  cells: Record<number, Record<number, NormalizedCell>>;
  merges: NormalizedRange[];
  rows: NormalizedDimension[];
  columns: NormalizedDimension[];
  frozenRows: number;
  frozenColumns: number;
  hidden: boolean;
}
export interface NormalizedWorkbook {
  schemaVersion: 1;
  id: string;
  properties: { title?: string; subject?: string; author?: string; company?: string; createdAt?: string; modifiedAt?: string };
  sheetOrder: string[];
  sheets: NormalizedWorksheet[];
}

export type CompatibilitySupport = "fully_supported" | "partially_supported" | "not_supported" | "unknown";
export interface CompatibilityIssue { feature: string; support: CompatibilitySupport; message: string; sheetId?: string }
export interface CompatibilityReport { issues: CompatibilityIssue[]; warningCount: number; hasUnsupportedFeatures: boolean }

export interface LoadedWorkbook {
  objectId: string;
  name: string;
  contentType: string;
  revision: number;
  readOnly: boolean;
  workspace: SpreadsheetWorkspace;
  workbook: NormalizedWorkbook;
  compatibility: CompatibilityReport;
  dek: CryptoKey;
  /** Present when the workbook was opened through a DirectShare (recipient mode). */
  share?: { shareId: string; role: import("@/lib/orgs/shareRoles").ShareRole };
}
export interface SaveWorkbookInput { loaded: LoadedWorkbook; workbook: NormalizedWorkbook; signal?: AbortSignal }
export interface SaveWorkbookResult { revision: number; savedAt: string }
export interface SpreadsheetPersistenceAdapter {
  load(objectId: string, signal?: AbortSignal): Promise<LoadedWorkbook>;
  save(input: SaveWorkbookInput): Promise<SaveWorkbookResult>;
  dispose?(): void;
}
export interface CollaborationContext { objectId: string; workspace: SpreadsheetWorkspace }
export interface SpreadsheetCollaborationAdapter {
  connect(context: CollaborationContext): Promise<void>;
  disconnect(): Promise<void>;
  publishUpdate(update: Uint8Array): Promise<void>;
  subscribe(handler: (update: Uint8Array) => void): () => void;
}

export function spreadsheetExtension(name: string): string { return name.split(".").pop()?.toLowerCase() ?? "" }
export function isSupportedSpreadsheet(name: string, contentType?: string): boolean {
  return SPREADSHEET_EXTENSIONS.has(spreadsheetExtension(name)) || (!!contentType && SPREADSHEET_MIME_TYPES.has(contentType.toLowerCase()));
}

