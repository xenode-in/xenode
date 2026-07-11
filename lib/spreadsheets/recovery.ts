import { getDb, type SpreadsheetDraftRecord } from "@/lib/db/local";
import { fromB64, toB64 } from "@/lib/crypto/utils";

export const SPREADSHEET_DRAFT_SCHEMA_VERSION = 1;
export function spreadsheetDraftId(workspaceId: string, objectId: string) { return `${workspaceId}:${objectId}`; }

export async function saveEncryptedSpreadsheetDraft(args: { userId: string; workspaceId: string; objectId: string; baseRevision: number; plaintext: ArrayBuffer; recoveryKey: CryptoKey }): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, args.recoveryKey, args.plaintext);
  const record: SpreadsheetDraftRecord = { id: spreadsheetDraftId(args.workspaceId, args.objectId), objectId: args.objectId, workspaceId: args.workspaceId, ciphertext: new Blob([ciphertext]), iv: toB64(iv), baseRevision: args.baseRevision, updatedAt: Date.now(), schemaVersion: SPREADSHEET_DRAFT_SCHEMA_VERSION };
  await getDb(args.userId).spreadsheetDrafts.put(record);
}
export async function loadEncryptedSpreadsheetDraft(args: { userId: string; workspaceId: string; objectId: string; recoveryKey: CryptoKey }): Promise<{ plaintext: ArrayBuffer; baseRevision: number; updatedAt: number } | null> {
  const record = await getDb(args.userId).spreadsheetDrafts.get(spreadsheetDraftId(args.workspaceId, args.objectId));
  if (!record || record.schemaVersion !== SPREADSHEET_DRAFT_SCHEMA_VERSION) return null;
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(record.iv) }, args.recoveryKey, await record.ciphertext.arrayBuffer());
  return { plaintext, baseRevision: record.baseRevision, updatedAt: record.updatedAt };
}
export async function deleteSpreadsheetDraft(userId: string, workspaceId: string, objectId: string) { await getDb(userId).spreadsheetDrafts.delete(spreadsheetDraftId(workspaceId, objectId)); }

