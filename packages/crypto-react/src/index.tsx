"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ProductKeyStore } from "./key-store";

export { ProductKeyStore } from "./key-store";

export interface ProductCryptoContextValue {
  productId: string;
  isUnlocked(spaceId: string): boolean;
  unlock(spaceId: string, handoffCiphertext: unknown): Promise<void>;
  lock(spaceId?: string): void;
  withProductKey<T>(
    spaceId: string,
    operation: (key: Uint8Array) => Promise<T> | T,
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
  const [, render] = useState(0);

  useEffect(() => {
    const current = store.current;
    return () => current.clear();
  }, []);

  const unlock = useCallback(
    async (spaceId: string, ciphertext: unknown) => {
      const key = await unwrapHandoff(productId, spaceId, ciphertext);
      try {
        store.current.set(spaceId, key);
      } finally {
        key.fill(0);
      }
      render((value) => value + 1);
    },
    [productId, unwrapHandoff],
  );

  const lock = useCallback((spaceId?: string) => {
    if (spaceId) store.current.delete(spaceId);
    else store.current.clear();
    render((value) => value + 1);
  }, []);

  const withProductKey = useCallback(
    <T,>(
      spaceId: string,
      operation: (key: Uint8Array) => Promise<T> | T,
    ) => store.current.withKey(spaceId, operation),
    [],
  );

  return (
    <ProductCryptoContext.Provider
      value={{
        productId,
        isUnlocked: (spaceId) => store.current.has(spaceId),
        unlock,
        lock,
        withProductKey,
      }}
    >
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
