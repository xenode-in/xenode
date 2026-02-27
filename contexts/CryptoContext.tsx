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
  /** Called after onboarding: setup vault with master password + recovery words */
  setup: (masterPassword: string, recoveryWords: string) => Promise<void>;
  /** Called on new device: enter master password to unlock */
  unlock: (masterPassword: string) => Promise<void>;
  /** Called from Settings: replace vault with new password + new recovery kit */
  regenerate: (newMasterPassword: string, newRecoveryWords: string) => Promise<void>;
  lock: () => Promise<void>;
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

  useEffect(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    setNeedsSetup(false);

    if (!userId) { setIsInitializing(false); return; }

    async function init() {
      setIsInitializing(true);
      try {
        const cached = await loadCachedKeys();
        if (cached) {
          setPrivateKey(cached.privateKey);
          setPublicKey(cached.publicKey);
          setIsUnlocked(true);
          return;
        }
        const res = await fetch("/api/keys/vault");
        if (res.status === 404) setNeedsSetup(true);
      } catch { /* network error */ }
      finally { setIsInitializing(false); }
    }
    init();
  }, [userId]);

  const setup = useCallback(async (masterPassword: string, recoveryWords: string) => {
    const keys = await setupUserKeyVault(masterPassword, recoveryWords);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const unlock = useCallback(async (masterPassword: string) => {
    const keys = await unlockVault(masterPassword);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    await cacheKeys(keys.privateKey, keys.publicKey);
  }, []);

  const regenerate = useCallback(async (newMasterPassword: string, newRecoveryWords: string) => {
    const keys = await regenerateVault(newMasterPassword, newRecoveryWords);
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
      isInitializing, isUnlocked, needsSetup, privateKey, publicKey,
      setup, unlock, regenerate, lock, isModalOpen, setModalOpen,
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
