"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { importProductKey } from "@xenode/crypto-core";
import { ProductKeyStore } from "./key-store";
import {
  clearPersistedKeys,
} from "./persistent-store";

export { ProductKeyStore } from "./key-store";
export {
  loadPersistedKey,
  savePersistedKey,
  deletePersistedKey,
  clearPersistedKeys,
  savePendingHandoff,
  loadPendingHandoff,
  clearPendingHandoff,
} from "./persistent-store";

export interface ProductCryptoContextValue {
  productId: string;
  isUnlocked(spaceId: string): boolean;
  /** Product keys are memory-only; retained for API compatibility and returns false. */
  restore(spaceId: string): Promise<boolean>;
  unlock(spaceId: string, handoffCiphertext: unknown): Promise<void>;
  /** Forget a space (or all) in memory. */
  lock(spaceId?: string): Promise<void>;
  withProductKey<T>(
    spaceId: string,
    operation: (key: CryptoKey) => Promise<T> | T,
  ): Promise<T>;
}

const ProductCryptoContext =
  createContext<ProductCryptoContextValue | null>(null);

export function ProductCryptoProvider({
  productId,
  unwrapHandoff,
  children,
}: {
  productId: string;
  unwrapHandoff: (
    productId: string,
    spaceId: string,
    ciphertext: unknown,
  ) => Promise<Uint8Array>;
  children: ReactNode;
}) {
  const store = useRef(new ProductKeyStore(productId));
  // Bumped whenever the in-memory key set changes; folded into the memoized
  // context value below so `isUnlocked` stays reactive without giving the value
  // a new identity on every unrelated render.
  const [version, setVersion] = useState(0);

  // Remove legacy product-key databases. New ProductSpaceKeys remain in memory.
  useEffect(() => {
    const current = store.current;
    void clearPersistedKeys(productId);
    return () => current.clear();
  }, [productId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`xenode-auth:${productId}`);
    channel.onmessage = (event) => {
      if (event.data?.type !== "logout") return;
      store.current.clear();
      void clearPersistedKeys(productId);
      setVersion((value) => value + 1);
      window.location.reload();
    };
    return () => channel.close();
  }, [productId]);

  const restore = useCallback(
    async (spaceId: string) => store.current.has(spaceId),
    [],
  );

  const unlock = useCallback(
    async (spaceId: string, ciphertext: unknown) => {
      const raw = await unwrapHandoff(productId, spaceId, ciphertext);
      let key: CryptoKey;
      try {
        key = await importProductKey(raw);
      } finally {
        raw.fill(0);
      }
      store.current.set(spaceId, key);
      setVersion((value) => value + 1);
    },
    [productId, unwrapHandoff],
  );

  const lock = useCallback(
    async (spaceId?: string) => {
      if (spaceId) {
        store.current.delete(spaceId);
      } else {
        store.current.clear();
        await clearPersistedKeys(productId);
      }
      setVersion((value) => value + 1);
    },
    [productId],
  );

  const withProductKey = useCallback(
    <T,>(spaceId: string, operation: (key: CryptoKey) => Promise<T> | T) =>
      store.current.withKey(spaceId, operation),
    [],
  );

  // Memoize so the context value keeps a stable identity across unrelated
  // re-renders — consumers that put `productCrypto` in effect deps must not see
  // a new object every render (that caused a render/fetch storm). `version` in
  // the deps refreshes the value (and `isUnlocked`) whenever the key set changes.
  const value = useMemo<ProductCryptoContextValue>(
    () => ({
      productId,
      isUnlocked: (spaceId) => store.current.has(spaceId),
      restore,
      unlock,
      lock,
      withProductKey,
    }),
    [productId, restore, unlock, lock, withProductKey, version],
  );

  return (
    <ProductCryptoContext.Provider value={value}>
      {children}
    </ProductCryptoContext.Provider>
  );
}

export function useProductCrypto(): ProductCryptoContextValue {
  const context = useContext(ProductCryptoContext);
  if (!context) {
    throw new Error("useProductCrypto must be used within ProductCryptoProvider");
  }
  return context;
}
