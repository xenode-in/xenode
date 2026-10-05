import { getDb } from "@/lib/db/local";
import { UploadJournal, sameUploadScope, type UploadRecord, type SealedUploadRecord,
  type UploadJournalScope, type UploadJournalStorage } from "@xenode/upload-engine";

export interface UploadJournalContext {
  scope: UploadJournalScope;
  key: CryptoKey;
  isActive: () => boolean;
}

export function journalStorage(accountId: string, isActive: () => boolean = () => true): UploadJournalStorage {
  const db = getDb(accountId);
  return {
    get: (id) => db.uploadJournal.get(id),
    async list(scope) {
      const rows = await db.uploadJournal.where("[scope.accountId+scope.spaceId]").equals([accountId, scope.spaceId]).toArray();
      return rows.filter((row) => sameUploadScope(row.scope, scope));
    },
    async insert(row) {
      await db.transaction("rw", db.uploadJournal, async () => {
        if (!isActive()) throw new Error("Upload context was locked");
        await db.uploadJournal.add(row);
      });
    },
    async compareAndSwap(previous, next) {
      return db.transaction("rw", db.uploadJournal, async () => {
        const current = await db.uploadJournal.get(previous.id);
        if (!current || current.revision !== previous.revision ||
          current.envelope.ciphertext !== previous.envelope.ciphertext || !sameUploadScope(current.scope, previous.scope)) return false;
        if (!isActive()) throw new Error("Upload context was locked");
        await db.uploadJournal.put(next);
        return true;
      });
    },
    async remove(id, scope) {
      await db.transaction("rw", db.uploadJournal, async () => {
        const current = await db.uploadJournal.get(id);
        if (current && sameUploadScope(current.scope, scope)) await db.uploadJournal.delete(id);
      });
    },
  };
}
export function uploadJournal(context: UploadJournalContext): UploadJournal {
  return new UploadJournal(journalStorage(context.scope.accountId, context.isActive), context.scope, context.key, context.isActive);
}
export async function saveUploadRecord(context: UploadJournalContext, record: UploadRecord): Promise<void> {
  await uploadJournal(context).save(record);
}
export async function markChunkComplete(context: UploadJournalContext, id: string, index: number): Promise<void> {
  await uploadJournal(context).markChunkComplete(id, index);
}
export async function getUploadRecord(context: UploadJournalContext, id: string): Promise<UploadRecord | undefined> {
  return uploadJournal(context).load(id);
}
/** Headers reveal only opaque scope/job identities. Payloads remain sealed until unlock. */
export async function listSealedUploadRecords(accountId: string, spaceId: string): Promise<SealedUploadRecord[]> {
  return getDb(accountId).uploadJournal.where("[scope.accountId+scope.spaceId]").equals([accountId, spaceId]).sortBy("createdAt");
}
export async function deleteUploadRecord(scope: UploadJournalScope, id: string): Promise<void> {
  await journalStorage(scope.accountId).remove(id, scope);
}
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist && navigator.storage.persisted &&
      !await navigator.storage.persisted()) await navigator.storage.persist();
  } catch { /* Optional durability; the server cleanup ledger remains authoritative. */ }
}
