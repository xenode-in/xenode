import { useEffect, useRef, useState } from "react";
import { getDb } from "@/lib/db/local";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";

export function useCryptoWorker() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { metadataKey } = useCrypto();
  const workerRef = useRef<Worker | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !userId || !metadataKey) return;

    // We init the worker inline in Next.js using URL
    const worker = new Worker(new URL("../lib/workers/crypto-worker", import.meta.url));
    workerRef.current = worker;

    worker.onmessage = async (e) => {
      if (e.data.type === "DECRYPT_BATCH_RESULT") {
        const results = e.data.results as { id: string; plaintext: string }[];
        if (results.length > 0) {
          const db = getDb(userId);
          await db.metadataCache.bulkPut(
            results.map((r) => ({ id: r.id, plaintext: r.plaintext }))
          );
        }
        processingRef.current = false;
        processNextBatch();
      } else if (e.data.type === "DECRYPT_BATCH_ERROR") {
        processingRef.current = false;
        processNextBatch();
      }
    };

    const processNextBatch = async () => {
      if (!workerRef.current || processingRef.current) return;
      processingRef.current = true;

      try {
        const db = getDb(userId);
        
        // Find encrypted files that don't have a cached version yet
        // A simple query: get 50 encrypted files
        // (For optimal performance, this should filter by items missing in metadataCache)
        const allFiles = await db.files.where("isEncrypted").equals("true").limit(200).toArray();
        const allCache = await db.metadataCache.toArray();
        const cacheSet = new Set(allCache.map(c => c.id));
        
        const toProcess = allFiles
            .map(f => f.encryptedName || f.encryptedDisplayName)
            .filter((val): val is string => !!val && !cacheSet.has(val))
            .slice(0, 50);

        if (toProcess.length === 0) {
          processingRef.current = false;
          return;
        }

        const rawKey = await crypto.subtle.exportKey("raw", metadataKey);
        
        workerRef.current.postMessage({
          type: "DECRYPT_BATCH",
          payload: {
            rawKey,
            items: toProcess.map(str => ({ id: str, ciphertext: str }))
          }
        });

      } catch (err) {
        processingRef.current = false;
      }
    };

    // Start processing queue
    const interval = setInterval(processNextBatch, 2000);
    processNextBatch();

    return () => {
      clearInterval(interval);
      worker.terminate();
    };
  }, [userId, metadataKey]);
}
