/**
 * lib/office-editor/conversion/formats.ts
 *
 * Pure helpers describing the x2t conversion matrix used by the Office editor. Kept
 * side-effect free so they can be unit tested without a browser or the WASM
 * engine.
 *
 * ONLYOFFICE's internal editing format is the "binary document" (`Editor.bin`).
 * x2t converts spreadsheet packages (xlsx/xls/csv/ods) <-> that binary form.
 */

/** Human file extensions the Office editor will attempt to open. */
export const V2_INPUT_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);

/** Extensions we will export back to (Editor.bin -> package). */
export const V2_OUTPUT_EXTENSIONS = new Set(["xlsx"]);

// x2t infers the conversion from the MEMFS file EXTENSIONS (see engine.ts), so
// there is no numeric-format-id plumbing here — the scratch names below carry
// the right extensions (`.xlsx`/`.bin`) and x2t does the rest.

export function isSupportedInputExtension(ext: string): boolean {
  return V2_INPUT_EXTENSIONS.has(ext.toLowerCase());
}

/** The internal input/output file names handed to the WASM MEMFS. Deterministic
 *  and document-independent so they never leak a real file name. */
export function scratchNames(ext: string): { input: string; bin: string; output: string } {
  const safe = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    input: `input.${safe}`,
    bin: "Editor.bin",
    output: `output.${safe}`,
  };
}

/** Lightweight sniff so a mislabeled/hostile payload is caught before we spend
 *  memory converting it. XLSX/XLS/ODS are ZIP or OLE containers; CSV is text. */
export function looksLikePackage(bytes: Uint8Array, ext: string): boolean {
  const e = ext.toLowerCase();
  if (e === "csv") return true; // any bytes are plausibly CSV
  if (bytes.byteLength < 8) return false;
  // ZIP local file header "PK\x03\x04" (xlsx/ods)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return true;
  // OLE2 compound file magic (legacy xls): D0 CF 11 E0 A1 B1 1A E1
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return true;
  }
  return false;
}
