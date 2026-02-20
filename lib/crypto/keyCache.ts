/**
 * lib/crypto/keyCache.ts
 * Store / restore the user's in-memory CryptoKey pair in IndexedDB so the
 * vault doesn't need to be re-unlocked on every page refresh.
 *
 * CryptoKey objects are structured-cloneable and can be stored in IDB even
 * when marked non-extractable — the browser keeps the raw key material opaque.
 */

const DB_NAME = "xenode-crypto";
const STORE_NAME = "keys";
const PRIVATE_KEY_ID = "privateKey";
const PUBLIC_KEY_ID = "publicKey";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the key pair so it survives page refreshes. */
export async function cacheKeys(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(privateKey, PRIVATE_KEY_ID);
    store.put(publicKey, PUBLIC_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a previously cached key pair. Returns null if nothing is stored. */
export async function loadCachedKeys(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
} | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const privReq = store.get(PRIVATE_KEY_ID);
      const pubReq = store.get(PUBLIC_KEY_ID);
      tx.oncomplete = () => {
        const priv = privReq.result as CryptoKey | undefined;
        const pub = pubReq.result as CryptoKey | undefined;
        if (priv && pub) resolve({ privateKey: priv, publicKey: pub });
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
