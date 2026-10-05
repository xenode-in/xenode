import { getDb, getSearchIndex } from "./local";
import { mapServerObjectToLocalFile, type ServerObject } from "./object-cache";

export interface SyncScope { accountId: string; spaceId: string }
export interface SyncPage {
  accountId: string;
  spaceId: string;
  cursor: string;
  reset: boolean;
  hasMore: boolean;
  changes: Array<{ objectId: string; syncVersion: number; type: "upsert" | "remove"; object?: ServerObject }>;
}
export async function clearSyncScope(scope: SyncScope) {
  const db = getDb(scope.accountId);
  await db.transaction("rw", db.files, db.syncStates, db.syncRemovals, async () => {
    await db.files.where("spaceId").equals(scope.spaceId).delete();
    await db.syncRemovals.where("spaceId").equals(scope.spaceId).delete();
    await db.syncStates.delete(scope.spaceId);
  });
  getSearchIndex(scope.accountId, scope.spaceId).clear();
}
export async function readSyncCursor(scope: SyncScope) {
  return (await getDb(scope.accountId).syncStates.get(scope.spaceId))?.cursor ?? null;
}

/** Data and its checkpoint commit together; stale pages/tabs cannot advance it. */
export async function applySyncPage(scope: SyncScope, previousCursor: string | null, page: SyncPage, isActive: () => boolean) {
  if (!page || page.accountId !== scope.accountId || page.spaceId !== scope.spaceId ||
    typeof page.cursor !== "string" || page.cursor.length > 2048 || !page.cursor ||
    typeof page.reset !== "boolean" || typeof page.hasMore !== "boolean" ||
    !Array.isArray(page.changes) || page.changes.length > 1000) throw new Error("Invalid scoped sync page");
  for (const change of page.changes) {
    if (!/^[a-f0-9]{24}$/u.test(change.objectId) || !Number.isSafeInteger(change.syncVersion) || change.syncVersion < 0 ||
      !["upsert", "remove"].includes(change.type) || (change.type === "upsert" &&
        (!change.object || change.object.spaceId !== scope.spaceId || String(change.object._id ?? change.object.id) !== change.objectId ||
          change.object.syncVersion !== change.syncVersion || typeof change.object.bucketId !== "string"))) {
      throw new Error("Invalid scoped sync change");
    }
  }
  const db = getDb(scope.accountId);
  return db.transaction("rw", db.files, db.syncStates, db.syncRemovals, async () => {
    if (!isActive()) throw new Error("Sync context changed");
    const current = (await db.syncStates.get(scope.spaceId))?.cursor ?? null;
    if (current !== previousCursor) return false;
    if (page.reset) {
      if (previousCursor !== null) throw new Error("Unexpected sync reset");
      await db.files.where("spaceId").equals(scope.spaceId).delete();
      await db.syncRemovals.where("spaceId").equals(scope.spaceId).delete();
    }
    for (const change of page.changes) {
      const row = await db.files.get(change.objectId);
      const removed = await db.syncRemovals.get([scope.spaceId, change.objectId]);
      const latest = Math.max(row?.spaceId === scope.spaceId ? row.syncVersion : -1, removed?.syncVersion ?? -1);
      if (latest > change.syncVersion) continue;
      if (change.type === "remove") {
        if (row?.spaceId === scope.spaceId) await db.files.delete(change.objectId);
        await db.syncRemovals.put({ id: change.objectId, spaceId: scope.spaceId, syncVersion: change.syncVersion });
      } else if (!removed || removed.syncVersion < change.syncVersion) {
        await db.files.put(mapServerObjectToLocalFile(change.object!, String(change.object!.bucketId)));
        await db.syncRemovals.delete([scope.spaceId, change.objectId]);
      }
    }
    if (!isActive()) throw new Error("Sync context changed");
    await db.syncStates.put({ spaceId: scope.spaceId, cursor: page.cursor });
    return true;
  });
}
