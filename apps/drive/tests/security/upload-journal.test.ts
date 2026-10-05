import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveMetadataKey, deriveUploadJournalKey, generateProductSpaceKey, openEnvelopeWithKey } from "@xenode/crypto-core";
import { UploadJournal, type UploadJournalScope, type UploadRecord } from "@xenode/upload-engine";
import { journalStorage } from "@/lib/uploads/persistence";
import { getDb, XenodeDatabase } from "@/lib/db/local";

const accounts = new Set<string>();
const scope = (accountId: string): UploadJournalScope => ({ accountId, productId: "drive", spaceId: "space_one",
  wrappedBy: "space", spaceKeyVersion: 1 });
async function fixture() {
  const accountId = crypto.randomUUID();
  accounts.add(accountId);
  const binding = scope(accountId);
  const root = generateProductSpaceKey();
  const key = await deriveUploadJournalKey(root, "drive", binding.spaceId);
  const store = journalStorage(accountId);
  const journal = new UploadJournal(store, binding, key);
  const record: UploadRecord = { id: "opaque_job", userId: accountId, spaceId: binding.spaceId,
    wrappedBy: "space", spaceKeyVersion: 1, spaceKeyWrapIv: "space_wrap_iv", status: "uploading", createdAt: 1,
    fileName: "private-tax-return.pdf", size: 4, type: "application/pdf", mediaCategory: "pdf",
    bucketId: "0123456789abcdef01234567", folderId: null, isChunked: true, isEncrypted: true,
    fileId: "opaque_reserved_key", sessionId: "1123456789abcdef01234567", uploadContentType: "application/octet-stream",
    encryptedDEK: "wrapped_file_key", chunkSize: 2, cipherChunkSize: 18, chunkCount: 2,
    chunkIvs: JSON.stringify(["iv_zero", "iv_one"]), completedChunks: [], encryptedName: "sealed_name",
    encryptedMetadata: "sealed_metadata", bytesPersisted: true, mainBytes: new Blob([new Uint8Array(36)]) };
  return { accountId, binding, root, key, store, journal, record };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const account of accounts) await new XenodeDatabase(account).delete();
  accounts.clear();
});

describe("sealed upload checkpoints in IndexedDB", () => {
  it("stores ciphertext only, discards caller extras, and restores every wrap/context field", async () => {
    const f = await fixture();
    await f.journal.save({ ...f.record, rawProductKey: [11, 22, 33] } as UploadRecord);
    const row = await f.store.get(f.record.id);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(f.record.fileName);
    expect(serialized).not.toContain("application/pdf");
    expect(serialized).not.toContain("rawProductKey");
    const restored = await f.journal.load(f.record.id);
    expect(restored).toMatchObject({ userId: f.accountId, spaceId: f.binding.spaceId, wrappedBy: "space",
      spaceKeyVersion: 1, spaceKeyWrapIv: f.record.spaceKeyWrapIv, fileName: f.record.fileName });
    expect(await restored!.mainBytes!.arrayBuffer()).toEqual(await f.record.mainBytes!.arrayBuffer());
    expect(Object.values(row!)).not.toContain(f.key);
  });
  it("journal and metadata HKDF purposes cannot open each other's envelopes", async () => {
    const f = await fixture();
    await f.journal.save(f.record);
    const row = (await f.store.get(f.record.id))!;
    const metadataKey = await deriveMetadataKey(f.root, "drive", f.binding.spaceId);
    await expect(openEnvelopeWithKey(row.envelope, metadataKey, row.envelope)).rejects.toThrow();
  });
  it.each(["accountId", "spaceId", "productId", "wrappedBy", "spaceKeyVersion"])("rejects another %s", async (field) => {
    const f = await fixture();
    await f.journal.save(f.record);
    const other = { ...f.binding, [field]: field === "spaceKeyVersion" ? 2 : "other" } as UploadJournalScope;
    await expect(new UploadJournal(f.store, other, f.key).load(f.record.id)).rejects.toThrow();
  });
  it.each(["id", "revision", "createdAt"])("rejects changed journal header %s", async (field) => {
    const f = await fixture();
    await f.journal.save(f.record);
    const row = (await f.store.get(f.record.id))!;
    await getDb(f.accountId).uploadJournal.put({ ...row, [field]: field === "id" ? "another_job" : 2 });
    await expect(f.journal.load(field === "id" ? "another_job" : f.record.id)).rejects.toThrow();
  });
  it("rejects swapped or changed ciphertext before returning a resumable record", async () => {
    const f = await fixture();
    await f.journal.save(f.record);
    await getDb(f.accountId).uploadJournal.update(f.record.id, { mainBytes: new Blob([new Uint8Array(36).fill(1)]) });
    await expect(f.journal.load(f.record.id)).rejects.toThrow("ciphertext changed");
  });
  it("merges concurrent checkpoints through real Dexie read/write transactions", async () => {
    const f = await fixture();
    await f.journal.save(f.record);
    const secondTab = new UploadJournal(journalStorage(f.accountId), f.binding, f.key);
    await Promise.all([f.journal.markChunkComplete(f.record.id, 0), secondTab.markChunkComplete(f.record.id, 1)]);
    expect((await f.journal.load(f.record.id))?.completedChunks).toEqual([0, 1]);
    await f.journal.markChunkComplete(f.record.id, 1);
    expect((await f.store.get(f.record.id))?.revision).toBe(3);
  });
  it("a cancellation winning the checkpoint race cannot be resurrected", async () => {
    const f = await fixture();
    await f.journal.save(f.record);
    const swap = f.store.compareAndSwap;
    f.store.compareAndSwap = async (previous, next) => { await f.store.remove(previous.id, f.binding); return swap(previous, next); };
    await f.journal.markChunkComplete(f.record.id, 0);
    expect(await f.store.get(f.record.id)).toBeUndefined();
  });
  it("a lock during asynchronous sealing prevents persistence", async () => {
    const f = await fixture();
    let active = true;
    const store = journalStorage(f.accountId, () => active);
    const journal = new UploadJournal(store, f.binding, f.key, () => active);
    const bytes = f.record.mainBytes!;
    vi.spyOn(bytes, "slice").mockImplementation(() => { active = false; return new Blob([new Uint8Array(36)]); });
    await expect(journal.save(f.record)).rejects.toThrow("no longer active");
    expect(await store.get(f.record.id)).toBeUndefined();
  });
  it("rejects missing workspace wraps, plaintext flags and invalid checkpoint indices", async () => {
    const f = await fixture();
    await expect(f.journal.save({ ...f.record, spaceKeyWrapIv: undefined })).rejects.toThrow();
    await expect(f.journal.save({ ...f.record, isEncrypted: false } as unknown as UploadRecord)).rejects.toThrow();
    await f.journal.save(f.record);
    await expect(f.journal.markChunkComplete(f.record.id, 2)).rejects.toThrow("index");
  });
  it("drops the old plaintext upload store on the development format reset", async () => {
    const accountId = crypto.randomUUID();
    accounts.add(accountId);
    const old = new Dexie(`XenodeDB-${accountId}`);
    old.version(6).stores({ uploads: "id,status,createdAt" });
    await old.table("uploads").put({ id: "old", fileName: "plaintext-secret" });
    old.close();
    const current = new XenodeDatabase(accountId);
    await current.open();
    expect(current.tables.map((table) => table.name)).not.toContain("uploads");
    expect(await current.uploadJournal.count()).toBe(0);
    current.close();
  });
});
