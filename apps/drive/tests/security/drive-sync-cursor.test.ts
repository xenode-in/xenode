import mongoose from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import { Space, DriveSyncTombstone, withTransaction, readDriveSyncPage, stampDriveSyncObjects,
  recordDriveSyncRemoval, parseDriveSyncCursor, updateDriveObjectMetadata } from "@xenode/database";
import StorageObject from "@/models/StorageObject";

async function scope(id = "sync_space") {
  await Space.create({ _id: id, type: "personal", ownerAccountId: id, createdByAccountId: id });
  return { accountId: id, spaceId: id };
}
async function object(spaceId: string, extra: Record<string, unknown> = {}) {
  return StorageObject.create({ spaceId, productId: "drive", createdByAccountId: spaceId,
    bucketId: new mongoose.Types.ObjectId(), key: `users/${spaceId}/${crypto.randomUUID()}`,
    size: 16, contentType: "application/octet-stream", b2FileId: "cipher", isEncrypted: true,
    encryptedName: "cipher-name", encryptedDEK: "sealed-key", ...extra });
}
describe("commit-ordered scoped sync tuples", () => {
  // An index build queued behind the intentionally held writer would block
  // later IX locks and turn this fixture into a DDL lock test.
  beforeAll(async () => { await Promise.all([Space.init(), StorageObject.init(), DriveSyncTombstone.init()]); });
  it("paginates every equal-time/equal-version object with an id tie-breaker", async () => {
    const s = await scope();
    const rows = await Promise.all(Array.from({ length: 7 }, () => object(s.spaceId, { updatedAt: new Date(0) })));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await readDriveSyncPage({ ...s, cursor, limit: 2 });
      seen.push(...page.changes.map((change) => change.objectId));
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(seen.sort()).toEqual(rows.map((row) => String(row._id)).sort());
    expect(new Set(seen).size).toBe(rows.length);
  });
  it("a pinned snapshot catches changes made during pagination on the next delta", async () => {
    const s = await scope();
    const firstId = new mongoose.Types.ObjectId("000000000000000000000001");
    const secondId = new mongoose.Types.ObjectId("000000000000000000000002");
    await object(s.spaceId, { _id: firstId });
    await object(s.spaceId, { _id: secondId });
    const first = await readDriveSyncPage({ ...s, limit: 1 });
    await updateDriveObjectMetadata({ spaceId: s.spaceId, objectId: String(secondId), starred: true });
    const tail = await readDriveSyncPage({ ...s, cursor: first.cursor, limit: 1 });
    expect(tail.changes).toEqual([]);
    const delta = await readDriveSyncPage({ ...s, cursor: tail.cursor });
    expect(delta.changes).toMatchObject([{ objectId: String(secondId), type: "upsert", object: { starred: true } }]);
  });
  it("clock regressions and repeated timestamps cannot hide a committed update", async () => {
    const s = await scope();
    const row = await object(s.spaceId);
    const initial = await readDriveSyncPage(s);
    await withTransaction(async (session) => {
      await StorageObject.updateOne({ _id: row._id }, { $set: { updatedAt: new Date(0) } }, { session, timestamps: false });
      await stampDriveSyncObjects(s.spaceId, { _id: row._id }, session);
    });
    const delta = await readDriveSyncPage({ ...s, cursor: initial.cursor });
    expect(delta.changes).toHaveLength(1);
    expect(delta.changes[0].syncVersion).toBe(1);
  });
  it("keeps a hard-purge tombstone after the object and its data are gone", async () => {
    const s = await scope();
    const row = await object(s.spaceId);
    const initial = await readDriveSyncPage(s);
    await withTransaction(async (session) => {
      await recordDriveSyncRemoval(s.spaceId, row._id, session);
      await StorageObject.deleteOne({ _id: row._id }, { session });
    });
    expect(await StorageObject.findById(row._id)).toBeNull();
    expect((await readDriveSyncPage({ ...s, cursor: initial.cursor })).changes)
      .toEqual([{ objectId: String(row._id), syncVersion: 1, type: "remove" }]);
    const tombstone = await DriveSyncTombstone.findById(row._id).lean();
    expect(Object.keys(tombstone!)).not.toContain("key");
    expect(Object.keys(tombstone!)).not.toContain("encryptedName");
  });
  it("rollback keeps counter, rows and deletion markers unchanged", async () => {
    const s = await scope();
    const row = await object(s.spaceId);
    await expect(withTransaction(async (session) => {
      await recordDriveSyncRemoval(s.spaceId, row._id, session);
      await StorageObject.deleteOne({ _id: row._id }, { session });
      throw new Error("interrupt");
    })).rejects.toThrow("interrupt");
    expect(await StorageObject.findById(row._id)).not.toBeNull();
    expect(await DriveSyncTombstone.countDocuments()).toBe(0);
    expect((await Space.findById(s.spaceId))?.driveSyncVersion).toBe(0);
  });
  it("does not expose an uncommitted version or skip a late commit", async () => {
    const s = await scope();
    const row = await object(s.spaceId);
    let ready!: () => void;
    let release!: () => void;
    const started = new Promise<void>((done) => { ready = done; });
    const resume = new Promise<void>((done) => { release = done; });
    const mutation = withTransaction(async (session) => {
      await stampDriveSyncObjects(s.spaceId, { _id: row._id }, session);
      ready(); await resume;
    });
    await started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let before: Awaited<ReturnType<typeof readDriveSyncPage>>;
    try {
      before = await Promise.race([readDriveSyncPage(s), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Snapshot reader blocked by uncommitted writer")), 5000); })]);
      expect(before.changes[0].syncVersion).toBe(0);
    } finally { if (timer) clearTimeout(timer); release(); await mutation; }
    expect((await readDriveSyncPage({ ...s, cursor: before.cursor })).changes[0].syncVersion).toBe(1);
  });
  it("rejects cursors from another account/Space, malformed dates and unsafe limits", async () => {
    const s = await scope();
    const page = await readDriveSyncPage(s);
    expect(() => parseDriveSyncCursor(page.cursor, "another", s.spaceId)).toThrow();
    expect(() => parseDriveSyncCursor(page.cursor, s.accountId, "another")).toThrow();
    await expect(readDriveSyncPage({ ...s, cursor: "1970-01-01" })).rejects.toThrow();
    await expect(readDriveSyncPage({ ...s, limit: 1001 })).rejects.toThrow();
  });
  it("scopes removals and excludes other products, sidecars and server key material", async () => {
    const s = await scope();
    await object(s.spaceId);
    await object(s.spaceId, { productId: "photos" });
    await object(s.spaceId, { isSidecar: true });
    const other = await scope("other_space");
    await object(other.spaceId);
    const page = await readDriveSyncPage(s);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].object).not.toHaveProperty("encryptedDEK");
    expect(page.changes[0].object).not.toHaveProperty("versions");
  });
  it("renames files and folders with sealed names only, and publishes the change", async () => {
    const s = await scope();
    const sealed = () => Buffer.concat([Buffer.from([4]), crypto.getRandomValues(Buffer.alloc(40))]).toString("base64");
    const file = await object(s.spaceId);
    const folder = await object(s.spaceId, { contentType: "application/x-directory", encryptedName: undefined, encryptedDisplayName: sealed() });
    const before = await readDriveSyncPage(s);
    const fileName = sealed(), folderName = sealed();
    await updateDriveObjectMetadata({ spaceId: s.spaceId, objectId: String(file._id), encryptedName: fileName });
    await updateDriveObjectMetadata({ spaceId: s.spaceId, objectId: String(folder._id), encryptedName: folderName });
    expect((await StorageObject.findById(file._id).lean())?.encryptedName).toBe(fileName);
    const renamedFolder = await StorageObject.findById(folder._id).lean();
    expect(renamedFolder?.encryptedDisplayName).toBe(folderName);
    expect(renamedFolder?.encryptedName).toBeUndefined();
    expect((await readDriveSyncPage({ ...s, cursor: before.cursor })).changes).toHaveLength(2);
    await expect(updateDriveObjectMetadata({ spaceId: s.spaceId, objectId: String(file._id), encryptedName: "report.pdf" }))
      .rejects.toMatchObject({ code: "invalid_encrypted_name" });
    const other = await scope("rename_other");
    expect(await updateDriveObjectMetadata({ spaceId: other.spaceId, objectId: String(file._id), encryptedName: sealed() })).toBeNull();
  });
});
