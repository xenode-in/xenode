const DB_NAME = "xenode-crypto";
const STORE_NAME = "keys";
const PRIVATE_KEY_ID = "privateKey";
const PUBLIC_KEY_ID = "publicKey";
const METADATA_KEY_ID = "metadataKey";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2); // Upgrade version to 2
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the key pair so it survives page refreshes. */
export async function cacheKeys(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  metadataKey?: CryptoKey, // Optional for backwards compatibility
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(privateKey, PRIVATE_KEY_ID);
    store.put(publicKey, PUBLIC_KEY_ID);
    if (metadataKey) {
      store.put(metadataKey, METADATA_KEY_ID);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a previously cached key pair. Returns null if nothing is stored. */
export async function loadCachedKeys(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  metadataKey?: CryptoKey;
} | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const privReq = store.get(PRIVATE_KEY_ID);
      const pubReq = store.get(PUBLIC_KEY_ID);
      const metaReq = store.get(METADATA_KEY_ID);
      
      tx.oncomplete = () => {
        const priv = privReq.result as CryptoKey | undefined;
        const pub = pubReq.result as CryptoKey | undefined;
        const meta = metaReq.result as CryptoKey | undefined;
        if (priv && pub) resolve({ privateKey: priv, publicKey: pub, metadataKey: meta });
        else resolve(null);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null; // IDB unavailable (private browsing on some browsers)
  }
}

/** Wipe cached keys (call on lock / logout). */
export async function clearCachedKeys(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
