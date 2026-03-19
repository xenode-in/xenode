import { useEffect, useCallback, useState, useRef } from "react";
import { db, searchIndex, LocalFile } from "@/lib/db/local";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { loadCachedKeys } from "@/lib/crypto/keyCache";

export function useSyncManager() {
  const [isSyncing, setIsSyncing] = useState(false);
  const syncLock = useRef(false);

  const sync = useCallback(async () => {
    if (syncLock.current) return;
    syncLock.current = true;
    setIsSyncing(true);

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

        const toAdd: LocalFile[] = [];

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          let name = f.key.split('/').pop() || f.key;
          
          if (f.isEncrypted && f.encryptedName) {
            try {
              name = await decryptMetadataString(f.encryptedName, keys?.metadataKey || null);
            } catch (err) {
              name = "Encrypted File";
            }
          }

          toAdd.push({
            id: String(f._id),
            key: f.key,
            name,
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

        if (toAdd.length > 0) {
          // Bulk upsert into Dexie
          await db.files.bulkPut(toAdd);
          
          // Update lastSync to the latest updatedAt in this batch
          const latestTime = Math.max(...toAdd.map(f => new Date(f.updatedAt).getTime()));
          lastSync = new Date(latestTime).toISOString();
          localStorage.setItem("lastSync", lastSync);
        }

        // Continue if we hit the limit
        if (files.length < 1000) {
          hasMore = false;
        }
      }
      
      // Update the MiniSearch index at the very end
      const allFiles = await db.files.toArray();
      searchIndex.removeAll();
      searchIndex.addAll(allFiles);

    } catch (error) {
      console.error("[SyncManager] Error syncing:", error);
    } finally {
      syncLock.current = false;
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    sync();
    // Re-sync every 60 seconds
    const interval = setInterval(sync, 60000);
    return () => clearInterval(interval);
  }, [sync]);

  return { isSyncing, sync };
}
