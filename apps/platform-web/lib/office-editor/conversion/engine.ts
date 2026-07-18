/**
 * lib/office-editor/conversion/engine.ts
 *
 * Abstraction over the x2t WASM converter. The rest of the app talks to
 * `X2tEngine`; concrete engines (the real browser WASM module, or a test fake)
 * implement it. This keeps the conversion policy (guards) testable without
 * shipping or loading the multi-hundred-MB WASM in unit tests.
 *
 * The real engine is produced by the out-of-band build in
 * `tools/onlyoffice/Dockerfile.x2t` and lands at
 * `${ONLYOFFICE_EDITOR_URL}/x2t/x2t.js` (+ `x2t.wasm`). Until that artifact is
 * present, `loadBrowserX2tEngine()` rejects with `x2t_unavailable`, which the UI
 * surfaces as "v2 not ready — falling back to v1".
 *
 * Usage validated against CryptPad's test.js (scripts/onlyoffice/
 * verify-x2t-roundtrip.mjs): x2t reads a TaskQueueDataConvert params XML, infers
 * the conversion from the m_sFileFrom / m_sFileTo file EXTENSIONS (`.bin` =
 * Editor.bin), needs a populated font dir to measure text, and is invoked via
 * `ccall("main1", "number", ["string"], [paramsPath])` returning 0 on success.
 */

/** MEMFS layout x2t expects (mirrors CryptPad's test.js). */
export const WORKING_DIR = "/working";
export const FONTS_DIR = "/working/fonts";
export const THEMES_DIR = "/working/themes";

export interface X2tConversion {
  /** Raw bytes to convert. */
  input: Uint8Array;
  /** MEMFS file name INCLUDING extension — x2t infers the input format from it
   *  (e.g. `input.xlsx`, `Editor.bin`). Document-independent. */
  inputName: string;
  /** MEMFS output file name including extension — drives the output format
   *  (e.g. `Editor.bin`, `output.xlsx`). */
  outputName: string;
}

export interface X2tEngine {
  convert(request: X2tConversion): Promise<Uint8Array>;
  /** Release the WASM instance / worker. Idempotent. */
  dispose(): void;
}

export class X2tUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("x2t_unavailable");
    this.name = "X2tUnavailableError";
    if (cause) this.cause = cause;
  }
}

/**
 * Shape the compiled glue is expected to expose. The CryptPad x2t Emscripten
 * module (onlyoffice-x2t-wasm) mounts a MEMFS and runs the converter over files
 * written into it. Its build exports `_main1` (C `main1`) with
 * `EXPORTED_RUNTIME_METHODS=ccall,FS`, so the converter is invoked as
 * `ccall("main1", "number", ["string"], [paramsXmlPath])`.
 */
export const X2T_ENTRY_FUNCTION = "main1";

export interface RawX2tModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string, opts: { encoding: "binary" }): Uint8Array;
    unlink(path: string): void;
    mkdir(path: string): void;
  };
  /** Runs x2t against a params XML already written to MEMFS. Returns 0 on ok. */
  ccall(
    name: string,
    returnType: "number",
    argTypes: string[],
    args: unknown[],
  ): number;
}

const PARAMS_PATH = `${WORKING_DIR}/params.xml`;

function mkdirSafe(mod: RawX2tModule, path: string): void {
  try {
    mod.FS.mkdir(path);
  } catch {
    // already exists
  }
}

/** Create the /working tree x2t needs. Idempotent; safe to call repeatedly.
 *  Does NOT populate fonts — the caller (browserEngine) loads those once. */
export function ensureWorkDirs(mod: RawX2tModule): void {
  mkdirSafe(mod, "/tmp");
  mkdirSafe(mod, WORKING_DIR);
  mkdirSafe(mod, FONTS_DIR);
  mkdirSafe(mod, THEMES_DIR);
  mkdirSafe(mod, `${WORKING_DIR}/media`);
}

function buildParamsXml(inputName: string, outputName: string): string {
  // TaskQueueDataConvert. Format is inferred from the file extensions; the
  // numeric format-id fields are intentionally omitted (see module doc). Font
  // and theme dirs are required for text measurement. Nothing references a
  // network resource.
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<m_sFontDir>${FONTS_DIR}/</m_sFontDir>` +
    `<m_sThemeDir>${THEMES_DIR}</m_sThemeDir>` +
    `<m_sFileFrom>${WORKING_DIR}/${inputName}</m_sFileFrom>` +
    `<m_sFileTo>${WORKING_DIR}/${outputName}</m_sFileTo>` +
    `<m_bIsNoBase64>false</m_bIsNoBase64>` +
    `<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding>` +
    `<m_nCsvDelimiter>4</m_nCsvDelimiter>` +
    `</TaskQueueDataConvert>`
  );
}

/** Adapt a raw Emscripten x2t module to the `X2tEngine` contract. Exposed so
 *  both the main-thread loader and a future worker can reuse the conversion
 *  body. Assumes fonts have already been loaded into FONTS_DIR. */
export function adaptRawModule(mod: RawX2tModule): X2tEngine {
  return {
    async convert(request: X2tConversion): Promise<Uint8Array> {
      ensureWorkDirs(mod);
      const inPath = `${WORKING_DIR}/${request.inputName}`;
      const outPath = `${WORKING_DIR}/${request.outputName}`;
      mod.FS.writeFile(inPath, request.input);
      mod.FS.writeFile(
        PARAMS_PATH,
        new TextEncoder().encode(
          buildParamsXml(request.inputName, request.outputName),
        ),
      );
      const rc = mod.ccall(X2T_ENTRY_FUNCTION, "number", ["string"], [PARAMS_PATH]);
      if (rc !== 0) {
        safeUnlink(mod, inPath);
        safeUnlink(mod, PARAMS_PATH);
        throw new Error(`x2t_conversion_failed:${rc}`);
      }
      const output = mod.FS.readFile(outPath, { encoding: "binary" });
      // Release scratch immediately; plaintext must not linger in MEMFS. Fonts
      // and theme dirs are intentionally kept for the next conversion.
      safeUnlink(mod, inPath);
      safeUnlink(mod, outPath);
      safeUnlink(mod, PARAMS_PATH);
      // Copy out of the WASM heap so the returned buffer survives disposal.
      return output.slice();
    },
    dispose() {
      /* the raw module has no teardown hook; GC reclaims it */
    },
  };
}

function safeUnlink(mod: RawX2tModule, path: string): void {
  try {
    mod.FS.unlink(path);
  } catch {
    // already gone
  }
}
