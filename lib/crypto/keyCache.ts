const DB_NAME = "xenode-crypto";
const STORE_NAME = "keys";
const PRIVATE_KEY_ID = "privateKey";
const PUBLIC_KEY_ID = "publicKey";
const METADATA_KEY_ID = "metadataKey";
const LEGACY_PRIVATE_KEY_BUF_ID = "privateKeyBuf";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist non-extractable CryptoKeys so trusted devices survive refreshes. */
export async function cacheKeys(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  metadataKey?: CryptoKey,
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
    store.delete(LEGACY_PRIVATE_KEY_BUF_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load previously cached CryptoKeys. Returns null if nothing is stored. */
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
        if (priv && pub) {
          resolve({ privateKey: priv, publicKey: pub, metadataKey: meta });
        } else {
          resolve(null);
        }
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
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
