"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { setupUserKeyVault, unlockVault, regenerateVault } from "@/lib/crypto/keySetup";
import { cacheKeys, loadCachedKeys, clearCachedKeys } from "@/lib/crypto/keyCache";
import { useSession } from "@/lib/auth/client";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  // Called after user saves recovery kit — sets up vault + unlocks
  setup: (passphrase: string) => Promise<void>;
  // Called on new device — enter recovery words to unlock
  unlock: (passphrase: string) => Promise<void>;
  // Called from Settings — replace vault with new recovery kit
  regenerate: (newPassphrase: string) => Promise<void>;
  // Lock (clear IDB + memory)
  lock: () => Promise<void>;
  // Manual modal control (e.g. from lock button in sidebar)
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

export function CryptoProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const [isInitializing, setIsInitializing] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  // Reset + re-init on user change
  useEffect(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    setNeedsSetup(false);

    if (!userId) {
      setIsInitializing(false);
      return;
    }

    async function init() {
      setIsInitializing(true);
      try {
        // 1. Check IDB cache — silent unlock if keys are stored
        const cached = await loadCachedKeys();
        if (cached) {
          setPrivateKey(cached.privateKey);
          setPublicKey(cached.publicKey);
          setIsUnlocked(true);
          return;
        }
        // 2. Check if vault exists on server
        const res = await fetch("/api/keys/vault");
        if (res.status === 404) {
          setNeedsSetup(true);
        }
        // 200 = vault exists, needs unlock (recovery words)
      } catch {
        // network error — silently ignore
      } finally {
        setIsInitializing(false);
      }
    }

    init();
  }, [userId]);

  const setup = useCallback(async (passphrase: string) => {
    const keys = await setupUserKeyVault(passphrase);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const unlock = useCallback(async (passphrase: string) => {
    const keys = await unlockVault(passphrase);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const regenerate = useCallback(async (newPassphrase: string) => {
    const keys = await regenerateVault(newPassphrase);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const lock = useCallback(async () => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    await clearCachedKeys();
  }, []);

  return (
    <CryptoContext.Provider value={{
      isInitializing,
      isUnlocked,
      needsSetup,
      privateKey,
      publicKey,
      setup,
      unlock,
      regenerate,
      lock,
      isModalOpen,
      setModalOpen,
    }}>
      {children}
    </CryptoContext.Provider>
  );
}

export function useCrypto(): CryptoContextType {
  const ctx = useContext(CryptoContext);
  if (!ctx) throw new Error("useCrypto must be used within CryptoProvider");
  return ctx;
}
