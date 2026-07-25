/**
 * Persistent product-key cache backed by IndexedDB.
 *
 * Stores NON-EXTRACTABLE AES-GCM `CryptoKey` objects. IndexedDB structured-clones
 * CryptoKeys, so an unlocked ProductSpaceKey survives page reloads WITHOUT its raw
 * bytes ever being written to disk — the key can be used for encrypt/decrypt but
 * can never be read back out. This is what lets Drive/Photos auto-unlock silently
 * after the first key-handoff (mirrors the v1 `keyCache` approach).
 *
 * One IndexedDB database per product (`xenode-keys-<productId>`), one record per
 * spaceId in the `keys` object store.
 */

const STORE = "keys";

function dbName(productId: string): string {
  return `xenode-keys-${productId}`;
}

function isBrowser(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(productId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName(productId), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Load a persisted product key for a space, or null if none / not a browser. */
export async function loadPersistedKey(
  productId: string,
  spaceId: string,
): Promise<CryptoKey | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb(productId);
    try {
      const value = await tx<unknown>(db, "readonly", (store) =>
        store.get(spaceId),
      );
      return value instanceof CryptoKey ? value : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Persist a NON-EXTRACTABLE product key for a space. Best-effort. */
export async function savePersistedKey(
  productId: string,
  spaceId: string,
  key: CryptoKey,
): Promise<void> {
  if (!isBrowser()) return;
  if (key.extractable) {
    // Refuse to persist an extractable key — that would put usable key material
    // at rest. Callers must import product keys as non-extractable.
    throw new Error("Refusing to persist an extractable CryptoKey");
  }
  try {
    const db = await openDb(productId);
    try {
      await tx(db, "readwrite", (store) => store.put(key, spaceId));
    } finally {
      db.close();
    }
  } catch {
    /* persistence is best-effort; in-memory unlock still works */
  }
}

/** Remove a persisted key for a space. */
export async function deletePersistedKey(
  productId: string,
  spaceId: string,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb(productId);
    try {
      await tx(db, "readwrite", (store) => store.delete(spaceId));
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

/** Drop the entire product key database (full sign-out). */
export async function clearPersistedKeys(productId: string): Promise<void> {
  if (!isBrowser()) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(dbName(productId));
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * A separate IndexedDB database for short-lived, structured-cloneable values
 * that must survive a full-page navigation — specifically the redirect-based key
 * handoff's pending request (its binding + NON-EXTRACTABLE ephemeral ECDH
 * keypair). Kept apart from the product-key store so signing out (which clears
 * the key store) and consuming a handoff (which clears this) don't interfere.
 *
 * The ephemeral private key is non-extractable, so persisting it here never puts
 * usable raw key bytes on disk; it is deleted the moment the handoff is consumed.
 */
const PENDING_STORE = "pending";

function pendingDbName(productId: string): string {
  return `xenode-handoff-${productId}`;
}

function openPendingDb(productId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(pendingDbName(productId), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function pendingTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, mode);
    const request = run(transaction.objectStore(PENDING_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Persist the in-flight redirect handoff for a product. Best-effort. */
export async function savePendingHandoff(
  productId: string,
  value: unknown,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openPendingDb(productId);
    try {
      await pendingTx(db, "readwrite", (store) => store.put(value, "current"));
    } finally {
      db.close();
    }
  } catch {
    /* best-effort */
  }
}

/** Load the in-flight redirect handoff for a product, or null. */
export async function loadPendingHandoff(
  productId: string,
): Promise<unknown | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openPendingDb(productId);
    try {
      const value = await pendingTx<unknown>(db, "readonly", (store) =>
        store.get("current"),
      );
      return value ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Remove the in-flight redirect handoff for a product. */
export async function clearPendingHandoff(productId: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openPendingDb(productId);
    try {
      await pendingTx(db, "readwrite", (store) => store.delete("current"));
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}
