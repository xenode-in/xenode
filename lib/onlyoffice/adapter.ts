/**
 * lib/onlyoffice/adapter.ts
 *
 * The typed boundary between Xenode's editor shell (React) and the ONLYOFFICE
 * document engine.
 *
 * WHY a boundary: the real engine is ONLYOFFICE's `sdkjs` editor bundle plus the
 * `x2t` WASM converter (the format converter — NOT the editor itself). For true
 * client-side E2EE those assets must be *vendored* from CryptPad's AGPL-3.0
 * `onlyoffice-builds` and served same-origin under `public/onlyoffice/`. None of
 * the shell, crypto, auto-save, or toolbar code depends on that bundle directly —
 * they only ever talk to `OnlyOfficeAdapter`. Dropping in the vendored engine is
 * therefore a single, well-defined integration step (implement `createAdapter`
 * in the vendored module; see `x2tLoader.ts`).
 */

/** Formats the x2t converter can round-trip. PDF is view/export-only. */
export type DocFormat = "docx" | "xlsx" | "pptx" | "odt" | "csv" | "pdf";

/** Stateless, no-argument commands dispatched straight through to the engine. */
export type EditorCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "alignJustify"
  | "bulletList"
  | "numberedList"
  | "undo"
  | "redo";

export interface InsertTableOptions {
  rows: number;
  cols: number;
}

/**
 * An image to insert. `data` is already-decrypted plaintext bytes — the caller
 * is responsible for decrypting from E2EE storage before handing it over, and
 * the adapter must never let these bytes leave the browser.
 */
export interface InsertImageOptions {
  data: ArrayBuffer;
  mimeType: string;
}

export interface OnlyOfficeAdapterInit {
  /**
   * The sandboxed iframe the engine mounts into. The shell creates it with
   * `sandbox="allow-scripts allow-same-origin"`; the engine is served same-origin
   * under `/onlyoffice/` with a locked-down CSP (no cross-origin egress).
   */
  container: HTMLIFrameElement;
  /**
   * Decrypted document bytes. PLAINTEXT, in-memory only. Must never be written
   * to localStorage / sessionStorage / IndexedDB or logged.
   */
  document: ArrayBuffer;
  /** Source format, derived from the file's contentType/extension. */
  format: DocFormat;
  /** When false the engine opens read-only (e.g. PDF). */
  editable: boolean;
  /** Fired the first time the engine has parsed + rendered the document. */
  onReady: () => void;
  /** Fired on every user edit — drives the debounced auto-save. */
  onDirty: () => void;
  /** Fired if the engine fails to parse/render (corrupt doc, unsupported feature). */
  onError: (error: Error) => void;
}

/**
 * Everything the shell can ask the engine to do. Implemented by the vendored
 * ONLYOFFICE build (real) and by `stubAdapter` (interim, until vendoring).
 */
export interface OnlyOfficeAdapter {
  /** Apply a no-argument formatting/structure command. */
  exec(command: EditorCommand): void;
  setFontFamily(family: string): void;
  /** Size in points (e.g. 11, 14). */
  setFontSize(points: number): void;
  /** 0 = Normal/body text, 1–3 = H1–H3. */
  setHeading(level: 0 | 1 | 2 | 3): void;
  insertTable(options: InsertTableOptions): void;
  insertImage(options: InsertImageOptions): void;
  /** Serialize back to the document's native format (plaintext bytes). */
  save(): Promise<ArrayBuffer>;
  /** Serialize to a different format via x2t (e.g. export PDF). */
  exportAs(format: DocFormat): Promise<ArrayBuffer>;
  /**
   * Tear down the engine, remove listeners, and drop every reference to
   * plaintext bytes so they can be garbage-collected.
   */
  destroy(): void;
}

/** Factory the vendored engine module must expose (see `x2tLoader.ts`). */
export type CreateAdapter = (
  init: OnlyOfficeAdapterInit,
) => Promise<OnlyOfficeAdapter>;

/**
 * Thrown when the vendored ONLYOFFICE assets are not present under
 * `public/onlyoffice/`. The shell catches this to render the "engine unavailable"
 * error state (with a download fallback) instead of a broken editor.
 */
export class EngineNotVendoredError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "ONLYOFFICE engine assets were not found under /onlyoffice/. " +
          "Vendor CryptPad's onlyoffice-builds (sdkjs + x2t WASM) to enable the editor.",
    );
    this.name = "EngineNotVendoredError";
  }
}

/** Thrown when a document cannot be decrypted (wrong key / corrupted blob). */
export class DocumentDecryptError extends Error {
  constructor(message = "Failed to decrypt document.") {
    super(message);
    this.name = "DocumentDecryptError";
  }
}

const CONTENT_TYPE_MAP: Record<string, DocFormat> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "text/csv": "csv",
  "application/pdf": "pdf",
};

const EXTENSION_MAP: Record<string, DocFormat> = {
  docx: "docx",
  doc: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  pptx: "pptx",
  ppt: "pptx",
  odt: "odt",
  csv: "csv",
  pdf: "pdf",
};

/**
 * Resolve a {@link DocFormat} from a MIME type, falling back to the filename
 * extension. Returns null when the file is not a supported document type.
 */
export function resolveDocFormat(
  contentType: string | null | undefined,
  fileName: string | null | undefined,
): DocFormat | null {
  if (contentType) {
    const direct = CONTENT_TYPE_MAP[contentType.split(";")[0].trim()];
    if (direct) return direct;
  }
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext && EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];
  }
  return null;
}

/** PDF is the only currently view-only format. */
export function isEditableFormat(format: DocFormat): boolean {
  return format !== "pdf";
}

/** MIME type for a freshly-serialized document of the given format. */
export function contentTypeForFormat(format: DocFormat): string {
  const entry = Object.entries(CONTENT_TYPE_MAP).find(([, f]) => f === format);
  return entry?.[0] ?? "application/octet-stream";
}
