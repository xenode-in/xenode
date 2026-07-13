import type { CompatibilityReport, NormalizedWorkbook, SpreadsheetExportFormat } from "./types";

const DEFAULT_MAX_BYTES = Number(process.env.NEXT_PUBLIC_SHEETS_MAX_BYTES || 100 * 1024 * 1024);
const DEFAULT_MAX_CELLS = Number(process.env.NEXT_PUBLIC_SHEETS_MAX_CELLS || 2_000_000);

export class SpreadsheetLimitError extends Error { constructor(message: string) { super(message); this.name = "SpreadsheetLimitError"; } }

export class SpreadsheetWorkerClient {
  private worker: Worker;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  constructor() {
    this.worker = new Worker(new URL("./workers/spreadsheet.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event) => {
      const callback = this.pending.get(event.data.id); if (!callback) return;
      this.pending.delete(event.data.id); if (event.data.ok) callback.resolve(event.data); else callback.reject(new Error(event.data.error));
    };
  }
  private request<T>(message: Record<string, unknown>, transfer?: Transferable[], signal?: AbortSignal): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const abort = () => { this.pending.delete(id); reject(new DOMException("Aborted", "AbortError")); };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve: (value) => { signal?.removeEventListener("abort", abort); resolve(value as T); }, reject });
      this.worker.postMessage({ ...message, id }, { transfer });
    });
  }
  async parse(buffer: ArrayBuffer, signal?: AbortSignal): Promise<{ workbook: NormalizedWorkbook; compatibility: CompatibilityReport }> {
    if (buffer.byteLength > DEFAULT_MAX_BYTES) throw new SpreadsheetLimitError(`Workbook exceeds the initial ${Math.round(DEFAULT_MAX_BYTES / 1024 / 1024)} MB safety limit.`);
    const result = await this.request<{ workbook: NormalizedWorkbook; compatibility: CompatibilityReport }>({ type: "parse", buffer }, [buffer], signal);
    const cells = result.workbook.sheets.reduce((sum, sheet) => sum + sheet.rowCount * sheet.columnCount, 0);
    if (cells > DEFAULT_MAX_CELLS) throw new SpreadsheetLimitError("Workbook dimensions exceed the initial editor safety limit.");
    return result;
  }
  async export(workbook: NormalizedWorkbook, signal?: AbortSignal, format: SpreadsheetExportFormat = "xlsx"): Promise<ArrayBuffer> { return (await this.request<{ buffer: ArrayBuffer }>({ type: "export", workbook, format }, undefined, signal)).buffer; }
  dispose() { this.worker.terminate(); for (const pending of this.pending.values()) pending.reject(new DOMException("Disposed", "AbortError")); this.pending.clear(); }
}

