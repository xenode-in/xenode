/**
 * lib/crypto/keyCache.ts
 * Store / restore the user's in-memory CryptoKey pair in IndexedDB so the
 * vault doesn't need to be re-unlocked on every page refresh.
 *
 * Keys are scoped per-user (prefixed with userId) so that multiple accounts
 * on the same browser don't bleed into each other.
 *
 * CryptoKey objects are structured-cloneable and can be stored in IDB even
 * when marked non-extractable — the browser keeps the raw key material opaque.
 */

const DB_NAME = "xenode-crypto";
const STORE_NAME = "keys";

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

/** Persist the key pair so it survives page refreshes. Keys are scoped to userId. */
export async function cacheKeys(
  userId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(privateKey, `${userId}:privateKey`);
    store.put(publicKey, `${userId}:publicKey`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a previously cached key pair for a specific user. Returns null if nothing is stored. */
export async function loadCachedKeys(userId: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
} | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const privReq = store.get(`${userId}:privateKey`);
      const pubReq = store.get(`${userId}:publicKey`);
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

/** Wipe cached keys for a specific user (call on lock / logout). */
export async function clearCachedKeys(userId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(`${userId}:privateKey`);
      store.delete(`${userId}:publicKey`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Wipe ALL cached keys across all users (nuclear option — use only for full reset). */
export async function clearAllCachedKeys(): Promise<void> {
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
