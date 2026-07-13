/**
 * lib/spreadsheets/v2/conversion/x2tClient.ts
 *
 * High-level conversion facade used by the persistence/editor layers. Applies
 * all size/format policy, then delegates the raw byte crunching to an
 * `X2tEngine`. The engine is loaded lazily so the WASM is fetched only when a
 * v2 workbook is actually opened, and disposed on teardown.
 *
 * Tests inject a fake engine via `X2tClientOptions.engineFactory`; production
 * uses the browser WASM loader.
 */

import {
  assertEditorBinSize,
  assertWorkbookSize,
  WorkbookLimitError,
} from "../limits";
import {
  isSupportedInputExtension,
  looksLikePackage,
  scratchNames,
} from "./formats";
import { X2tEngine, X2tUnavailableError } from "./engine";

export interface X2tClientOptions {
  /** Overrides the default browser WASM loader (used by tests). */
  engineFactory?: () => Promise<X2tEngine>;
}

export class X2tClient {
  private engine: X2tEngine | null = null;
  private loading: Promise<X2tEngine> | null = null;
  private disposed = false;
  private readonly engineFactory: () => Promise<X2tEngine>;

  constructor(opts: X2tClientOptions = {}) {
    this.engineFactory =
      opts.engineFactory ??
      (async () => {
        // Dynamic import keeps the WASM loader out of the initial bundle and
        // out of non-browser (test/SSR) contexts unless explicitly used.
        const { loadBrowserX2tEngine } = await import("./browserEngine");
        return loadBrowserX2tEngine();
      });
  }

  private async ensureEngine(): Promise<X2tEngine> {
    if (this.disposed) throw new X2tUnavailableError("client_disposed");
    if (this.engine) return this.engine;
    if (!this.loading) {
      this.loading = this.engineFactory().then((engine) => {
        this.engine = engine;
        return engine;
      });
      this.loading.catch(() => {
        // Allow a later retry after a transient load failure.
        this.loading = null;
      });
    }
    return this.loading;
  }

  /** Convert a decrypted workbook package (xlsx/xls/csv) to Editor.bin. */
  async toEditorBin(bytes: Uint8Array, extension: string): Promise<Uint8Array> {
    const ext = extension.toLowerCase();
    if (!isSupportedInputExtension(ext)) {
      throw new WorkbookLimitError(`unsupported_input:${ext}`, "unsupported_input");
    }
    assertWorkbookSize(bytes.byteLength);
    if (!looksLikePackage(bytes, ext)) {
      throw new WorkbookLimitError("workbook_not_recognized", "workbook_not_recognized");
    }
    const names = scratchNames(ext);
    const engine = await this.ensureEngine();
    const bin = await engine.convert({
      input: bytes,
      inputName: names.input,
      outputName: names.bin,
    });
    assertEditorBinSize(bin.byteLength);
    return bin;
  }

  /** Convert an edited Editor.bin back to an XLSX package for encryption. */
  async fromEditorBinToXlsx(bin: Uint8Array): Promise<Uint8Array> {
    assertEditorBinSize(bin.byteLength);
    const names = scratchNames("xlsx");
    const engine = await this.ensureEngine();
    const xlsx = await engine.convert({
      input: bin,
      inputName: names.bin,
      outputName: names.output,
    });
    assertWorkbookSize(xlsx.byteLength);
    return xlsx;
  }

  dispose(): void {
    this.disposed = true;
    this.engine?.dispose();
    this.engine = null;
    this.loading = null;
  }
}
