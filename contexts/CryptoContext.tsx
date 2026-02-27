"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  setupVaultWithPRF,
  setupUserKeyVault,
  unlockVaultWithPRF,
  unlockVault,
} from "@/lib/crypto/keySetup";
import {
  cacheKeys,
  loadCachedKeys,
  clearCachedKeys,
} from "@/lib/crypto/keyCache";
import { useSession } from "@/lib/auth/client";

export type VaultUnlockMethod = "prf" | "passphrase" | "cached";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  vaultType: "prf" | "passphrase" | null;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  // PRF path — biometric only, no password
  setupWithPRF: (userId: string, userName: string) => Promise<{ supported: boolean }>;
  unlockWithPRF: () => Promise<{ supported: boolean }>;
  // Passphrase fallback
  setup: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
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
  const [vaultType, setVaultType] = useState<"prf" | "passphrase" | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // Reset on user change (logout / account switch)
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

      // 1. Try IDB cache first (survives refresh, scoped per user)
      const cached = await loadCachedKeys(userId!);
      if (cached) {
        setPrivateKey(cached.privateKey);
        setPublicKey(cached.publicKey);
        setIsUnlocked(true);
        setVaultType("prf"); // cached — either path, doesn't matter
        setIsInitializing(false);
        return;
      }

      // 2. No cache — check vault existence + type
      try {
        const res = await fetch("/api/keys/vault");
        if (res.status === 404) {
          setNeedsSetup(true);
        } else if (res.ok) {
          const data = await res.json();
          setVaultType(data.vaultType ?? "passphrase");
          // Vault exists — modal will prompt unlock
        }
      } catch {
        // network error
      } finally {
        setIsInitializing(false);
      }
    }

    init();
  }, [userId]);

  // ── PRF setup (onboarding) ──────────────────────────────────────────────────
  const setupWithPRF = useCallback(
    async (uid: string, uName: string) => {
      const result = await setupVaultWithPRF(uid, uName);
      if (!result.supported) return { supported: false };
      setPrivateKey(result.privateKey);
      setPublicKey(result.publicKey);
      setIsUnlocked(true);
      setNeedsSetup(false);
      setVaultType("prf");
      await cacheKeys(uid, result.privateKey, result.publicKey);
      return { supported: true };
    },
    [],
  );

  // ── PRF unlock (login on new device) ───────────────────────────────────────
  const unlockWithPRF = useCallback(async () => {
    if (!userId) throw new Error("Not authenticated");
    try {
      const keys = await unlockVaultWithPRF();
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      setVaultType("prf");
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

  // ── Passphrase setup (fallback) ─────────────────────────────────────────────
  const setup = useCallback(
    async (password: string) => {
      if (!userId) throw new Error("Not authenticated");
      const keys = await setupUserKeyVault(password);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      setNeedsSetup(false);
      setVaultType("passphrase");
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
    },
    [userId],
  );

  // ── Passphrase unlock (fallback) ────────────────────────────────────────────
  const unlock = useCallback(
    async (password: string) => {
      if (!userId) throw new Error("Not authenticated");
      const keys = await unlockVault(password);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setIsUnlocked(true);
      setVaultType("passphrase");
      await cacheKeys(userId, keys.privateKey, keys.publicKey);
    },
    [userId],
  );

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
        setupWithPRF,
        unlockWithPRF,
        setup,
        unlock,
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
