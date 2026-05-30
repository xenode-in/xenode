/** Auto-save state-machine states, surfaced by the floating status indicator. */
export type SaveStatus =
  | "idle" // no unsaved changes
  | "dirty" // edits pending, debounce not yet fired
  | "saving" // encrypting + uploading
  | "saved" // last save succeeded
  | "error" // save failed (retrying with backoff)
  | "conflict"; // remote copy diverged since load

/** What went wrong on load, so the error state can offer the right recovery. */
export type EditorErrorKind =
  | "engine" // vendored ONLYOFFICE assets missing → download fallback
  | "decrypt" // wrong key / corrupted blob → no partial content
  | "parse" // engine couldn't render the doc → offer raw download
  | "unsupported" // not an editable document type
  | "generic";

export interface EditorError {
  kind: EditorErrorKind;
  message: string;
}
