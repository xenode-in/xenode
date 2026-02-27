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
  addPassphraseLayerToVault,
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
  // Setup (onboarding fallback — passphrase vault from scratch)
  setup: (passphrase: string) => Promise<void>;
  // Add PRF layer on top of existing passphrase vault (Settings)
  addPRFLayer: (passphrase: string, userId: string, userName: string) => Promise<{ supported: boolean }>;
  // Add passphrase layer on top of existing PRF vault (unlock fallback or Settings)
  addPassphraseLayer: (newPassphrase: string) => Promise<void>;
  // Unlock
  unlock: (passphrase: string) => Promise<void>;
  unlockWithPRF: () => Promise<{ supported: boolean }>;
  // Lock
  lock: () => Promise<void>;
  // Refresh vault type from server (after adding a layer)
  refreshVaultType: () => Promise<void>;
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

  // ── Init: check IDB cache then vault ──────────────────────────────────────
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
        // 1. Try IDB cache — keys survive page refresh
        const cached = await loadCachedKeys(userId!);
        if (cached) {
          setPrivateKey(cached.privateKey);
          setPublicKey(cached.publicKey);
          setIsUnlocked(true);
          setIsInitializing(false);
          return;
        }

        // 2. Check vault existence + type from server
        const res = await fetch("/api/keys/vault");
        if (res.status === 404) {
          setNeedsSetup(true);
        } else if (res.ok) {
          const data = await res.json();
          setVaultType(data.vaultType ?? "passphrase");
        }
      } catch {
        // network error — silently ignore
      } finally {
        setIsInitializing(false);
      }
    }

    init();
  }, [userId]);

  // ── Refresh vault type (call after adding a new layer) ────────────────────
  const refreshVaultType = useCallback(async () => {
    try {
      const res = await fetch("/api/keys/vault");
      if (res.ok) {
        const data = await res.json();
        setVaultType(data.vaultType ?? "passphrase");
        if (res.status === 404) setNeedsSetup(true);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Setup: passphrase vault from scratch ──────────────────────────────────
  const setup = useCallback(async (passphrase: string) => {
    if (!userId) throw new Error("Not authenticated");
    const keys = await setupUserKeyVault(passphrase);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
    setVaultType("passphrase");
    await cacheKeys(userId, keys.privateKey, keys.publicKey);
  }, [userId]);

  // ── Add PRF layer (Settings: passphrase user adds passkey) ────────────────
  const addPRFLayer = useCallback(async (
    passphrase: string,
    uid: string,
    uName: string,
  ) => {
    const result = await addPRFLayerToVault(passphrase, uid, uName);
    if (result.supported) setVaultType("both");
    return result;
  }, []);

  // ── Add passphrase layer (PRF user adds passphrase backup) ────────────────
  const addPassphraseLayer = useCallback(async (newPassphrase: string) => {
    await addPassphraseLayerToVault(newPassphrase);
    setVaultType("both");
  }, []);

  // ── Unlock: passphrase ────────────────────────────────────────────────────
  const unlock = useCallback(async (passphrase: string) => {
    if (!userId) throw new Error("Not authenticated");
    const keys = await unlockVault(passphrase);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    await cacheKeys(userId, keys.privateKey, keys.publicKey);
  }, [userId]);

  // ── Unlock: PRF passkey ───────────────────────────────────────────────────
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
      if (e instanceof Error &&
        (e.message === "PRF_NOT_SUPPORTED" || e.message === "NOT_PRF_VAULT")) {
        return { supported: false };
      }
      throw e;
    }
  }, [userId]);

  // ── Lock ──────────────────────────────────────────────────────────────────
  const lock = useCallback(async () => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
    if (userId) await clearCachedKeys(userId);
  }, [userId]);

  return (
    <CryptoContext.Provider value={{
      isInitializing,
      isUnlocked,
      needsSetup,
      vaultType,
      privateKey,
      publicKey,
      setup,
      addPRFLayer,
      addPassphraseLayer,
      unlock,
      unlockWithPRF,
      lock,
      refreshVaultType,
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
