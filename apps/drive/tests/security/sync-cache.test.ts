import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, getSearchIndex, XenodeDatabase } from "@/lib/db/local";
import { applySyncPage, readSyncCursor, type SyncScope, type SyncPage } from "@/lib/db/sync";
import { createSyncRunner } from "@/lib/db/sync-runner";
import { upsertLocalObjects } from "@/lib/db/object-cache";

const accounts = new Set<string>();
function scope(spaceId = "space_one"): SyncScope {
  const accountId = crypto.randomUUID();
  accounts.add(accountId);
  return { accountId, spaceId };
}
const objectId = "0123456789abcdef01234567";
function page(s: SyncScope, syncVersion = 1, remove = false): SyncPage {
  return { ...s, cursor: `cursor_${syncVersion}`, reset: false, hasMore: false, changes: [{
    objectId, syncVersion, type: remove ? "remove" : "upsert",
    ...(remove ? {} : { object: { _id: objectId, spaceId: s.spaceId, key: "opaque", syncVersion,
      bucketId: "1123456789abcdef01234567", isEncrypted: true, encryptedName: "cipher", tags: [] } }),
  }] };
}
afterEach(async () => { for (const accountId of accounts) await new XenodeDatabase(accountId).delete(); accounts.clear(); });
describe("scoped cache checkpoints", () => {
  it("commits rows and cursor together, and rejects stale competing pages", async () => {
    const s = scope();
    expect(await applySyncPage(s, null, page(s), () => true)).toBe(true);
    expect(await readSyncCursor(s)).toBe("cursor_1");
    expect((await getDb(s.accountId).files.get(objectId))?.syncVersion).toBe(1);
    expect(await applySyncPage(s, null, page(s, 2), () => true)).toBe(false);
    expect(await readSyncCursor(s)).toBe("cursor_1");
  });
  it("keeps a removal guard so an older listing cannot resurrect the file", async () => {
    const s = scope();
    await applySyncPage(s, null, page(s), () => true);
    await applySyncPage(s, "cursor_1", page(s, 2, true), () => true);
    await upsertLocalObjects(s.accountId, [page(s).changes[0].object!], "1123456789abcdef01234567");
    expect(await getDb(s.accountId).files.get(objectId)).toBeUndefined();
    await applySyncPage(s, "cursor_2", page(s, 3), () => true);
    expect((await getDb(s.accountId).files.get(objectId))?.syncVersion).toBe(3);
  });
  it("clears only the selected Space on an initial snapshot reset", async () => {
    const s = scope();
    const other = { accountId: s.accountId, spaceId: "other_space" };
    await applySyncPage(s, null, page(s), () => true);
    const otherPage = page(other);
    otherPage.changes[0].objectId = "2123456789abcdef01234567";
    otherPage.changes[0].object!._id = otherPage.changes[0].objectId;
    await applySyncPage(other, null, otherPage, () => true);
    await getDb(s.accountId).syncStates.delete(s.spaceId);
    await applySyncPage(s, null, { ...page(s, 2), reset: true, changes: [] }, () => true);
    expect(await getDb(s.accountId).files.get(objectId)).toBeUndefined();
    expect(await getDb(s.accountId).files.get(otherPage.changes[0].objectId)).not.toBeUndefined();
    expect(await readSyncCursor(other)).toBe("cursor_1");
  });
  it("a lock/scope change during application rolls back both rows and checkpoint", async () => {
    const s = scope();
    let calls = 0;
    await expect(applySyncPage(s, null, page(s), () => ++calls === 1)).rejects.toThrow("context changed");
    expect(await readSyncCursor(s)).toBeNull();
    expect(await getDb(s.accountId).files.count()).toBe(0);
  });
  it("rejects wrong account/Space data before any cache write", async () => {
    const s = scope();
    await expect(applySyncPage(s, null, page({ ...s, accountId: "other" }), () => true)).rejects.toThrow();
    const p = page(s);
    p.changes[0].object!.spaceId = "other";
    await expect(applySyncPage(s, null, p, () => true)).rejects.toThrow();
    expect(await getDb(s.accountId).files.count()).toBe(0);
  });
  it("partitions decrypted search by account/Space and ignores late work after disposal", async () => {
    const s = scope();
    let release!: (response: Response) => void;
    const runner = createSyncRunner({ scope: s, canIndex: true, decrypt: async (file) => ({ ...file, name: "secret" }),
      fetch: () => new Promise<Response>((done) => { release = done; }) });
    const run = runner.run();
    while (!release) await new Promise((done) => setTimeout(done, 0));
    runner.dispose();
    release(Response.json(page(s)));
    await run;
    expect(await readSyncCursor(s)).toBeNull();
    expect(getSearchIndex(s.accountId, s.spaceId).index.documentCount).toBe(0);
    expect(getSearchIndex(s.accountId, "other")).not.toBe(getSearchIndex(s.accountId, s.spaceId));
  });
});
