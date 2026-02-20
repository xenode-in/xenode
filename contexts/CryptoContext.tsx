"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { setupUserKeyVault, unlockVault } from "@/lib/crypto/keySetup";
import {
  cacheKeys,
  loadCachedKeys,
  clearCachedKeys,
} from "@/lib/crypto/keyCache";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  unlock: (password: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  lock: () => void;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

export function CryptoProvider({ children }: { children: React.ReactNode }) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    async function init() {
      // 1. Try to restore keys from IndexedDB (survives page refresh)
      const cached = await loadCachedKeys();
      if (cached) {
        setPrivateKey(cached.privateKey);
        setPublicKey(cached.publicKey);
        setIsUnlocked(true);
        setIsInitializing(false);
        return;
      }

      // 2. No cached keys — check if the user has a vault set up
      try {
        const res = await fetch("/api/keys/vault");
        if (res.status === 404) setNeedsSetup(true);
        // 200 = vault exists, user needs to enter password
      } catch {
        // network error — ignore
      } finally {
        setIsInitializing(false);
      }
    }
    init();
  }, []);

  const unlock = useCallback(async (password: string) => {
    const keys = await unlockVault(password);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
    // Cache for next page load
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const setup = useCallback(async (password: string) => {
    const keys = await setupUserKeyVault(password);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const lock = useCallback(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    clearCachedKeys();
  }, []);

  return (
    <CryptoContext.Provider
      value={{
        isInitializing,
        isUnlocked,
        needsSetup,
        privateKey,
        publicKey,
        unlock,
        setup,
        lock,
        isModalOpen,
        setModalOpen,
      }}
    >
      {children}
    </CryptoContext.Provider>
  );
}

export function useCrypto(): CryptoContextType {
  const ctx = useContext(CryptoContext);
  if (!ctx) throw new Error("useCrypto must be used within CryptoProvider");
  return ctx;
}
