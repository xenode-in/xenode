/**
 * lib/spreadsheets/v2/recovery.ts
 *
 * Encrypted local recovery for Sheets v2. Periodically persists an encrypted
 * snapshot of the working document (Editor.bin or the exported XLSX) so an
 * iframe/worker/browser crash — or an offline session — does not lose edits.
 *
 * Invariants:
 *  - Snapshots are always AES-GCM encrypted with the caller's recovery key
 *    before touching IndexedDB. Plaintext workbook bytes never hit disk.
 *  - Uses a dedicated store (`spreadsheetV2Drafts`), never the v1 draft table.
 *  - "Local encrypted draft retained" is distinct from "saved to Xenode"; this
 *    module only ever touches local storage.
 */

import { getDb, type SpreadsheetV2DraftRecord } from "@/lib/db/local";
import { fromB64, toB64 } from "@/lib/crypto/utils";

export const SPREADSHEET_V2_DRAFT_SCHEMA_VERSION = 1;

export function v2DraftId(workspaceId: string, objectId: string): string {
  return `${workspaceId}:${objectId}`;
}

export interface SaveV2DraftArgs {
  userId: string;
  workspaceId: string;
  objectId: string;
  baseRevision: number;
  kind: "editor_bin" | "xlsx";
  /** Plaintext snapshot bytes; encrypted before persistence. */
  plaintext: ArrayBuffer;
  recoveryKey: CryptoKey;
}

export async function saveV2Draft(args: SaveV2DraftArgs): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    args.recoveryKey,
    args.plaintext,
  );
  const record: SpreadsheetV2DraftRecord = {
    id: v2DraftId(args.workspaceId, args.objectId),
    objectId: args.objectId,
    workspaceId: args.workspaceId,
    kind: args.kind,
    ciphertext: new Blob([ciphertext]),
    iv: toB64(iv),
    baseRevision: args.baseRevision,
    updatedAt: Date.now(),
    schemaVersion: SPREADSHEET_V2_DRAFT_SCHEMA_VERSION,
  };
  await getDb(args.userId).spreadsheetV2Drafts.put(record);
}

export interface LoadedV2Draft {
  plaintext: ArrayBuffer;
  kind: "editor_bin" | "xlsx";
  baseRevision: number;
  updatedAt: number;
}

export async function loadV2Draft(args: {
  userId: string;
  workspaceId: string;
  objectId: string;
  recoveryKey: CryptoKey;
}): Promise<LoadedV2Draft | null> {
  const record = await getDb(args.userId).spreadsheetV2Drafts.get(
    v2DraftId(args.workspaceId, args.objectId),
  );
  if (!record || record.schemaVersion !== SPREADSHEET_V2_DRAFT_SCHEMA_VERSION) {
    return null;
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(record.iv) },
    args.recoveryKey,
    await record.ciphertext.arrayBuffer(),
  );
  return {
    plaintext,
    kind: record.kind,
    baseRevision: record.baseRevision,
    updatedAt: record.updatedAt,
  };
}

export async function deleteV2Draft(
  userId: string,
  workspaceId: string,
  objectId: string,
): Promise<void> {
  await getDb(userId).spreadsheetV2Drafts.delete(v2DraftId(workspaceId, objectId));
}
