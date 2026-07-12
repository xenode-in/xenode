/**
 * lib/spreadsheets/v2/conversion/engine.ts
 *
 * Abstraction over the x2t WASM converter. The rest of the app talks to
 * `X2tEngine`; concrete engines (the real browser WASM module, or a test fake)
 * implement it. This keeps the conversion policy (guards, format mapping)
 * testable without shipping or loading the multi-hundred-MB WASM in unit tests.
 *
 * The real engine is produced by the out-of-band build in
 * `tools/onlyoffice/Dockerfile.x2t` and lands at
 * `${ONLYOFFICE_EDITOR_URL}/x2t/x2t.js` (+ `x2t.wasm`). Until that artifact is
 * present, `loadBrowserX2tEngine()` rejects with `x2t_unavailable`, which the UI
 * surfaces as "v2 not ready — falling back to v1".
 */

export interface X2tConversion {
  /** Raw bytes to convert. */
  input: Uint8Array;
  /** ONLYOFFICE numeric format id of the input. */
  inputFormat: number;
  /** ONLYOFFICE numeric format id of the desired output. */
  outputFormat: number;
  /** Internal MEMFS names (document-independent). */
  inputName: string;
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
 * `ccall("main1", "number", ["string"], [paramsXmlPath])`. We adapt that narrow
 * surface here in one place so a glue-API change is a one-file edit.
 *
 * NOTE: the exact entry name and argument convention must be reconciled against
 * the vendored `pre-js.js` wrapper when the WASM artifact is first built.
 */
export const X2T_ENTRY_FUNCTION = "main1";

export interface RawX2tModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string, opts: { encoding: "binary" }): Uint8Array;
    unlink(path: string): void;
    mkdir?(path: string): void;
  };
  /** Runs x2t against a params XML already written to MEMFS. Returns 0 on ok. */
  ccall(
    name: string,
    returnType: "number",
    argTypes: string[],
    args: unknown[],
  ): number;
}

const PARAMS_PATH = "/params.xml";

function buildParamsXml(inputName: string, outputName: string): string {
  // x2t reads a TaskQueueDataConvert XML. Only the fields required for a local
  // package<->bin conversion are set; nothing references a network resource.
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<m_sFileFrom>/${inputName}</m_sFileFrom>` +
    `<m_sFileTo>/${outputName}</m_sFileTo>` +
    `<m_bIsNoBase64>false</m_bIsNoBase64>` +
    `</TaskQueueDataConvert>`
  );
}

/** Adapt a raw Emscripten x2t module to the `X2tEngine` contract. Exposed so
 *  both the main-thread loader and the worker can reuse the conversion body. */
export function adaptRawModule(mod: RawX2tModule): X2tEngine {
  return {
    async convert(request: X2tConversion): Promise<Uint8Array> {
      const inPath = `/${request.inputName}`;
      const outPath = `/${request.outputName}`;
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
      // Release scratch immediately; plaintext must not linger in MEMFS.
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
