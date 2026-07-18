/**
 * lib/office-editor/types.ts
 *
 * Binary load/save contracts for the Office editor (ONLYOFFICE). Unlike the legacy
 * `SpreadsheetPersistenceAdapter`, which returns a `NormalizedWorkbook`, the v2
 * adapters round-trip the *original* decrypted workbook bytes so advanced Excel
 * content is never discarded by Xenode's normalized schema.
 *
 * Nothing here is allowed to place plaintext bytes anywhere a server can see
 * them: the server only ever receives ciphertext + opaque metadata.
 */

import type { SpreadsheetWorkspace } from "@/lib/spreadsheets/types";
import type { ShareRole } from "@/lib/orgs/shareRoles";

export type { SpreadsheetWorkspace };

/** The decrypted workbook exactly as it was stored, plus the keys/metadata
 *  needed to re-encrypt and save a new revision. Byte buffers here are
 *  plaintext and must be treated as sensitive (zeroed/released ASAP). */
export interface LoadedBinaryWorkbook {
  objectId: string;
  name: string;
  contentType: string;
  /** Lower-cased file extension, e.g. `xlsx`. Drives x2t input/output format. */
  extension: string;
  revision: number;
  readOnly: boolean;
  workspace: SpreadsheetWorkspace;
  /** Original decrypted workbook bytes (xlsx/xls/csv). */
  bytes: Uint8Array;
  /** File DEK, kept in memory only, reused to encrypt saves. */
  dek: CryptoKey;
  /** Present when opened through a DirectShare (recipient mode). */
  share?: { shareId: string; role: ShareRole };
}

export interface SaveBinaryInput {
  loaded: LoadedBinaryWorkbook;
  /** Exported workbook bytes (already the target on-disk format, e.g. xlsx). */
  bytes: Uint8Array;
  signal?: AbortSignal;
}

export interface SaveBinaryResult {
  revision: number;
  savedAt: string;
}

/** The v2 counterpart to `SpreadsheetPersistenceAdapter`. Deliberately a
 *  separate contract so the v1 path is never modified. */
export interface BinaryPersistenceAdapter {
  loadBinary(objectId: string, signal?: AbortSignal): Promise<LoadedBinaryWorkbook>;
  saveBinary(input: SaveBinaryInput): Promise<SaveBinaryResult>;
  dispose?(): void;
}

/** Raised when the server rejects a save because a newer revision exists. */
export class BinaryConflictError extends Error {
  constructor(public readonly latestRevision?: number) {
    super("A newer encrypted revision is already stored.");
    this.name = "BinaryConflictError";
  }
}
