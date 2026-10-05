import { getDb, getSearchIndex, type LocalFile } from "./local";
import { applySyncPage, clearSyncScope, readSyncCursor, type SyncPage, type SyncScope } from "./sync";

export function createSyncRunner(options: {
  scope: SyncScope;
  canIndex: boolean;
  decrypt(file: LocalFile): Promise<LocalFile>;
  fetch?: typeof fetch;
}) {
  let busy = false;
  let generation = 0;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const resource = getSearchIndex(options.scope.accountId, options.scope.spaceId);
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => busy,
    async run() {
      if (busy) return;
      busy = true;
      listeners.forEach((listener) => listener());
      const epoch = generation;
      controller = new AbortController();
      const signal = controller.signal;
      const active = () => generation === epoch && !signal.aborted;
      try {
        let cursor = await readSyncCursor(options.scope);
        while (active()) {
          const path = `/api/files/sync${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
          const response = await (options.fetch ?? fetch)(path, { credentials: "include", cache: "no-store",
            headers: { "x-xenode-space-id": options.scope.spaceId }, signal });
          if (!active()) return;
          if ([401, 403, 404].includes(response.status)) { await clearSyncScope(options.scope); return; }
          if (!response.ok) throw new Error("Sync request failed");
          const page = await response.json() as SyncPage;
          if (!active()) return;
          if (!await applySyncPage(options.scope, cursor, page, active)) return;
          cursor = page.cursor;
          if (!page.hasMore) break;
        }
        if (!active()) return;
        if (!options.canIndex) { resource.clear(); return; }
        const rows = await getDb(options.scope.accountId).files.where("spaceId").equals(options.scope.spaceId).toArray();
        const entries: LocalFile[] = [];
        for (const row of rows) {
          if (!active()) return;
          const file = await options.decrypt(row);
          if (!active()) return;
          entries.push(file);
        }
        resource.replace(entries);
      } finally {
        if (generation === epoch) {
          busy = false;
          listeners.forEach((listener) => listener());
        }
      }
    },
    dispose() {
      generation++;
      controller?.abort();
      busy = false;
      resource.clear();
      listeners.forEach((listener) => listener());
    },
  };
}
