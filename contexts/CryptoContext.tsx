"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  setupUserKeyVault,
  addPRFLayerToVault,
  unlockVault,
  unlockVaultWithPRF,
} from "@/lib/crypto/keySetup";
import { cacheKeys, loadCachedKeys, clearCachedKeys } from "@/lib/crypto/keyCache";
import { useSession } from "@/lib/auth/client";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  vaultType: "passphrase" | "prf" | "both" | null;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  // Setup (onboarding)
  setup: (passphrase: string) => Promise<void>;
  // Add PRF layer (onboarding optional step OR Settings)
  addPRFLayer: (passphrase: string, userId: string, userName: string) => Promise<{ supported: boolean }>;
  // Unlock
  unlock: (passphrase: string) => Promise<void>;
  unlockWithPRF: () => Promise<{ supported: boolean }>;
  // Lock
  lock: () => Promise<void>;
  // Modal control
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

export function CryptoProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const userName = session?.user?.email ?? session?.user?.name ?? "";

  const [isInitializing, setIsInitializing] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [vaultType, setVaultType] = useState<"passphrase" | "prf" | "both" | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    setNeedsSetup(false);
    setVaultType(null);

    if (!userId) {
      setIsInitializing(false);
      return;
    }

    async function init() {
      setIsInitializing(true);
      try {
        // 1. Try IDB cache first
        const cached = await loadCachedKeys(userId!);
        if (cached) {
          setPrivateKey(cached.privateKey);
          setPublicKey(cached.publicKey);
          setIsUnlocked(true);
          setIsInitializing(false);
          return;
        }

        // 2. Check vault existence + type
        const res = await fetch("/api/keys/vault");
        if (res.status === 404) {
          setNeedsSetup(true);
        } else if (res.ok) {
          const data = await res.json();
          setVaultType(data.vaultType ?? "passphrase");
        }
      } catch {
        // network error — leave as initializing=false, modal won't open
      } finally {
        setIsInitializing(false);
      }
    }

    init();
  }, [userId]);

  // ── Setup (passphrase, always first) ─────────────────────────────────────
  const setup = useCallback(
    async (passphrase: string) => {
      if (!userId) throw new Error("Not authenticated");
      const keys = await setupUserKeyVault(passphrase);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      setNeedsSetup(false);
      setVaultType("passphrase");
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
    },
    [userId],
  );

  // ── Add PRF layer on top of existing passphrase vault ───────────────────
  const addPRFLayer = useCallback(
    async (passphrase: string, uid: string, uName: string) => {
      const result = await addPRFLayerToVault(passphrase, uid, uName);
      if (result.supported) {
        setVaultType("both");
      }
      return result;
    },
    [],
  );

  // ── Unlock: passphrase ───────────────────────────────────────────────────
  const unlock = useCallback(
    async (passphrase: string) => {
      if (!userId) throw new Error("Not authenticated");
      const keys = await unlockVault(passphrase);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
    },
    [userId],
  );

  // ── Unlock: PRF passkey ───────────────────────────────────────────────
  const unlockWithPRF = useCallback(async () => {
    if (!userId) throw new Error("Not authenticated");
    try {
      const keys = await unlockVaultWithPRF();
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
      return { supported: true };
    } catch (e) {
      if (
        e instanceof Error &&
        (e.message === "PRF_NOT_SUPPORTED" || e.message === "NOT_PRF_VAULT")
      ) {
        return { supported: false };
      }
      throw e;
    }
  }, [userId]);

  // ── Lock ────────────────────────────────────────────────────────────────────
  const lock = useCallback(async () => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    setVaultType(null);
    if (userId) await clearCachedKeys(userId);
  }, [userId]);

  return (
    <CryptoContext.Provider
      value={{
        isInitializing,
        isUnlocked,
        needsSetup,
        vaultType,
        privateKey,
        publicKey,
        setup,
        addPRFLayer,
        unlock,
        unlockWithPRF,
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
