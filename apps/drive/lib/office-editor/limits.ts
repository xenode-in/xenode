/**
 * lib/office-editor/limits.ts
 *
 * Resource ceilings enforced *before* conversion so a malicious or accidental
 * oversized workbook cannot exhaust browser memory during x2t conversion. These
 * are intentionally separate from the legacy cell/byte limits: this pipeline holds
 * both the compressed XLSX and the (larger) decompressed Editor.bin in memory.
 */

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Largest encrypted-and-then-decrypted XLSX/XLS/CSV we will feed to x2t. */
export const MAX_WORKBOOK_BYTES = num(
  process.env.NEXT_PUBLIC_OFFICE_EDITOR_MAX_BYTES,
  75 * 1024 * 1024,
);

/** Largest Editor.bin (converted representation) we will accept back. Editor.bin
 *  is uncompressed and can be several times the size of the source package. */
export const MAX_EDITOR_BIN_BYTES = num(
  process.env.NEXT_PUBLIC_OFFICE_EDITOR_MAX_BIN_BYTES,
  300 * 1024 * 1024,
);

/** Largest single bridge message payload accepted in either direction. Bounds
 *  the damage a compromised/misbehaving iframe can do with one postMessage. */
export const MAX_BRIDGE_PAYLOAD_BYTES = num(
  process.env.NEXT_PUBLIC_OFFICE_EDITOR_MAX_BRIDGE_BYTES,
  MAX_EDITOR_BIN_BYTES,
);

export class WorkbookLimitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WorkbookLimitError";
  }
}

export function assertWorkbookSize(byteLength: number): void {
  if (byteLength > MAX_WORKBOOK_BYTES) {
    throw new WorkbookLimitError(
      `Workbook exceeds the ${Math.round(MAX_WORKBOOK_BYTES / 1024 / 1024)} MB Office editor safety limit.`,
      "workbook_too_large",
    );
  }
}

export function assertEditorBinSize(byteLength: number): void {
  if (byteLength > MAX_EDITOR_BIN_BYTES) {
    throw new WorkbookLimitError(
      `Converted document exceeds the ${Math.round(MAX_EDITOR_BIN_BYTES / 1024 / 1024)} MB Office editor safety limit.`,
      "editor_bin_too_large",
    );
  }
}
