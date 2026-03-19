import { useEffect, useCallback, useState, useRef } from "react";
import { getDb, searchIndex, LocalFile } from "@/lib/db/local";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { loadCachedKeys } from "@/lib/crypto/keyCache";
import { useSession } from "@/lib/auth/client";

export function useSyncManager() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [isSyncing, setIsSyncing] = useState(false);
  const syncLock = useRef(false);

  const sync = useCallback(async () => {
    if (!userId || syncLock.current) return;
    syncLock.current = true;
    setIsSyncing(true);

    const db = getDb(userId);

    try {
      let lastSync = localStorage.getItem("lastSync") || "1970-01-01T00:00:00.000Z";
      let hasMore = true;

      while (hasMore) {
        const keys = await loadCachedKeys();
        const res = await fetch(`/api/files/sync?lastSync=${lastSync}`);
        if (!res.ok) break;

        const data = await res.json();
        const files: any[] = data.files;
        if (!files || files.length === 0) break;

        const toStore: LocalFile[] = [];

        for (const f of files) {
          const fallbackName = f.key.split("/").pop() || f.key;
          toStore.push({
            id: String(f._id),
            key: f.key,
            encryptedName: f.isEncrypted && f.encryptedName ? f.encryptedName : null,
            // name is only used in the MiniSearch index; we'll fill it below
            name: fallbackName,
            size: f.size,
            contentType: f.contentType || "application/octet-stream",
            createdAt: new Date(f.createdAt).toISOString(),
            updatedAt: new Date(f.updatedAt).toISOString(),
            isEncrypted: f.isEncrypted || false,
            tags: f.tags || [],
            thumbnail: f.thumbnail,
            bucketId: String(f.bucketId),
          });
        }

        if (toStore.length > 0) {
          await db.files.bulkPut(toStore);
          const latestTime = Math.max(...toStore.map((f) => new Date(f.updatedAt).getTime()));
          lastSync = new Date(latestTime).toISOString();
          localStorage.setItem("lastSync", lastSync);
        }

        if (files.length < 1000) hasMore = false;
      }

      // Rebuild MiniSearch index in-memory with decrypted names
      // Dexie holds encryptedName; only RAM holds plaintext
      const keys = await loadCachedKeys();
      const allFiles = await db.files.toArray();

      const indexEntries = await Promise.all(
        allFiles.map(async (f) => {
          let name = f.name; // fallback (plaintext key basename for unencrypted files)
          if (f.isEncrypted && f.encryptedName) {
            try {
              name = await decryptMetadataString(f.encryptedName, keys?.metadataKey || null);
            } catch {
              name = "Encrypted File";
            }
          }
          return { ...f, name };
        }),
      );

      searchIndex.removeAll();
      searchIndex.addAll(indexEntries);
    } catch (error) {
      console.error("[SyncManager] Error syncing:", error);
    } finally {
      syncLock.current = false;
      setIsSyncing(false);
    }
  }, [userId]);

  useEffect(() => {
    sync();
    const interval = setInterval(sync, 60000);
    return () => clearInterval(interval);
  }, [sync]);

  return { isSyncing, sync };
}