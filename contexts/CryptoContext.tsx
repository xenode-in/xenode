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
import { useSession } from "@/lib/auth/client";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  unlock: (password: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
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
    // Reset crypto state whenever the logged-in user changes (incl. logout)
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
      // 1. Try to restore keys from IndexedDB scoped to this user
      const cached = await loadCachedKeys(userId!);
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
  }, [userId]);

  const unlock = useCallback(
    async (password: string) => {
      if (!userId) throw new Error("Not authenticated");
      const keys = await unlockVault(password);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      setNeedsSetup(false);
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
    },
    [userId],
  );

  const setup = useCallback(
    async (password: string) => {
      if (!userId) throw new Error("Not authenticated");
      const keys = await setupUserKeyVault(password);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      setNeedsSetup(false);
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
    },
    [userId],
  );

  // lock() is now async so DashboardShell can await it before calling signOut
  const lock = useCallback(async () => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    if (userId) {
      await clearCachedKeys(userId);
    }
  }, [userId]);

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
