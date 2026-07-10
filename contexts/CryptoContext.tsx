"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  recoverAndResetVault,
  regenerateVault,
  setupUserKeyVault,
  unlockVault,
  updateVaultPassword,
} from "@/lib/crypto/keySetup";
import { cacheKeys, clearCachedKeys, loadCachedKeys } from "@/lib/crypto/keyCache";
import { clearLocalDb } from "@/lib/db/local";
import { signOut, useSession } from "@/lib/auth/client";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  metadataKey: CryptoKey | null;
  /** Raw private key buffer - only in memory, used for passkey registration */
  privateKeyBuf: ArrayBuffer | null;
  setup: (masterPassword: string, recoveryWords: string) => Promise<void>;
  unlock: (masterPassword: string) => Promise<void>;
  regenerate: (
    newMasterPassword: string,
    newRecoveryWords: string,
  ) => Promise<void>;
  updatePassword: (
    currentPassword: string,
    newMasterPassword: string,
  ) => Promise<void>;
  recover: (recoveryWords: string, newMasterPassword: string) => Promise<void>;
  /** Lock vault in memory only (session continues) */
  lock: () => Promise<void>;
  /** Full logout - wipes local DB + clears keys */
  logout: () => Promise<void>;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

interface SyncedCryptoKeys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  metadataKey?: CryptoKey;
}

function getLoginRedirect(reason: string) {
  if (typeof window === "undefined") return `/login?reason=${reason}`;
  const next = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(next)}&reason=${reason}`;
}

export function CryptoProvider({
  children,
  initialUserId = null,
}: {
  children: React.ReactNode;
  initialUserId?: string | null;
}) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? initialUserId;

  const [isInitializing, setIsInitializing] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [metadataKey, setMetadataKey] = useState<CryptoKey | null>(null);
  const [privateKeyBuf, setPrivateKeyBuf] = useState<ArrayBuffer | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  const clearKeyState = useCallback(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setMetadataKey(null);
    setPrivateKeyBuf(null);
    setIsUnlocked(false);
  }, []);

  const signOutStaleVaultSession = useCallback(
    async (reason: string) => {
      clearKeyState();
      setNeedsSetup(false);
      setIsInitializing(false);
      sessionStorage.removeItem("xenode-vault-pw");
      await clearCachedKeys();
      if (userId) await clearLocalDb(userId);
      try {
        await signOut();
      } catch {
        /* session may already be invalid server-side */
      }
      if (typeof window !== "undefined") {
        window.location.replace(getLoginRedirect(reason));
      }
    },
    [clearKeyState, userId],
  );

  useEffect(() => {
    if (isPending && !initialUserId) return;

    clearKeyState();
    setNeedsSetup(false);

    if (!userId) {
      setIsInitializing(false);
      return;
    }

    async function init() {
      setIsInitializing(true);
      try {
        const cached = await loadCachedKeys();
        if (cached) {
          setPrivateKey(cached.privateKey);
          setPublicKey(cached.publicKey);
          setMetadataKey(cached.metadataKey || null);
          setPrivateKeyBuf(null);
          setIsUnlocked(true);
          return;
        }

        const hostname =
          typeof window !== "undefined" ? window.location.hostname : "";
        const isSubdomain =
          hostname.startsWith("docs.") || hostname.startsWith("admin.");

        if (isSubdomain) {
          const mainUrl =
            process.env.NEXT_PUBLIC_APP_URL ||
            (hostname.includes("localhost")
              ? "http://localhost:3000"
              : "https://xenode.in");

          const iframe = document.createElement("iframe");
          iframe.src = `${mainUrl}/sync`;
          iframe.style.display = "none";
          document.body.appendChild(iframe);

          const syncPromise = new Promise<SyncedCryptoKeys | null>((resolve) => {
            const timeout = setTimeout(() => resolve(null), 5000);

            const handleSync = async (event: MessageEvent) => {
              if (event.origin !== new URL(mainUrl).origin) return;

              if (event.data?.type === "XENODE_SYNC_READY") {
                iframe.contentWindow?.postMessage(
                  { type: "XENODE_GET_KEYS" },
                  mainUrl,
                );
              }

              if (event.data?.type === "XENODE_KEYS_RELAY") {
                clearTimeout(timeout);
                window.removeEventListener("message", handleSync);
                document.body.removeChild(iframe);
                resolve(event.data.keys as SyncedCryptoKeys);
              }

              if (event.data?.type === "XENODE_KEYS_NOT_FOUND") {
                clearTimeout(timeout);
                window.removeEventListener("message", handleSync);
                document.body.removeChild(iframe);
                resolve(null);
              }
            };
            window.addEventListener("message", handleSync);
          });

          const syncedKeys = await syncPromise;
          if (syncedKeys) {
            setPrivateKey(syncedKeys.privateKey);
            setPublicKey(syncedKeys.publicKey);
            setMetadataKey(syncedKeys.metadataKey || null);
            setPrivateKeyBuf(null);
            setIsUnlocked(true);
            await cacheKeys(
              syncedKeys.privateKey,
              syncedKeys.publicKey,
              syncedKeys.metadataKey,
            );
            return;
          }
        }

        const storedPw = sessionStorage.getItem("xenode-vault-pw");
        if (storedPw) {
          sessionStorage.removeItem("xenode-vault-pw");
          try {
            const keys = await unlockVault(storedPw);
            setPrivateKey(keys.privateKey);
            setPublicKey(keys.publicKey);
            setMetadataKey(keys.metadataKey || null);
            setPrivateKeyBuf(keys.privateKeyBuf);
            setIsUnlocked(true);
            await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
            return;
          } catch (e: unknown) {
            if (e instanceof Error && e.message === "NO_VAULT") {
              setNeedsSetup(true);
              return;
            }
            await signOutStaleVaultSession("vault_unlock_failed");
            return;
          }
        }

        const res = await fetch("/api/keys/vault", { credentials: "include" });
        if (res.status === 404) {
          setNeedsSetup(true);
          return;
        }
        if (res.status === 401) {
          await signOutStaleVaultSession("session_expired");
          return;
        }
        if (res.ok) {
          await signOutStaleVaultSession("vault_locked");
        }
      } catch {
        /* network error */
      } finally {
        setIsInitializing(false);
      }
    }

    void init();
  }, [clearKeyState, initialUserId, isPending, signOutStaleVaultSession, userId]);

  const setup = useCallback(
    async (masterPassword: string, recoveryWords: string) => {
      const keys = await setupUserKeyVault(masterPassword, recoveryWords);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setMetadataKey(keys.metadataKey || null);
      setPrivateKeyBuf(keys.privateKeyBuf);
      setIsUnlocked(true);
      setNeedsSetup(false);
      await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
    },
    [],
  );

  const unlock = useCallback(async (masterPassword: string) => {
    const keys = await unlockVault(masterPassword);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setMetadataKey(keys.metadataKey || null);
    setPrivateKeyBuf(keys.privateKeyBuf);
    setIsUnlocked(true);
    await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
  }, []);

  const regenerate = useCallback(
    async (newMasterPassword: string, newRecoveryWords: string) => {
      const keys = await regenerateVault(newMasterPassword, newRecoveryWords);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setMetadataKey(keys.metadataKey || null);
      setPrivateKeyBuf(keys.privateKeyBuf);
      setIsUnlocked(true);
      setNeedsSetup(false);
      await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
    },
    [],
  );

  const updatePassword = useCallback(
    async (currentPassword: string, newMasterPassword: string) => {
      const keys = await updateVaultPassword(currentPassword, newMasterPassword);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setMetadataKey(keys.metadataKey || null);
      setPrivateKeyBuf(keys.privateKeyBuf);
      setIsUnlocked(true);
      setNeedsSetup(false);
      await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
    },
    [],
  );

  const recover = useCallback(
    async (recoveryWords: string, newMasterPassword: string) => {
      const keys = await recoverAndResetVault(recoveryWords, newMasterPassword);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setMetadataKey(keys.metadataKey || null);
      setPrivateKeyBuf(keys.privateKeyBuf);
      setIsUnlocked(true);
      setNeedsSetup(false);
      await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
    },
    [],
  );

  const lock = useCallback(async () => {
    clearKeyState();
    await clearCachedKeys();
  }, [clearKeyState]);

  const logout = useCallback(async () => {
    clearKeyState();
    await clearCachedKeys();
    if (userId) await clearLocalDb(userId);
  }, [clearKeyState, userId]);

  return (
    <CryptoContext.Provider
      value={{
        isInitializing,
        isUnlocked,
        needsSetup,
        privateKey,
        publicKey,
        metadataKey,
        privateKeyBuf,
        setup,
        unlock,
        regenerate,
        updatePassword,
        recover,
        lock,
        logout,
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

export function useOptionalCrypto(): CryptoContextType | undefined {
  return useContext(CryptoContext);
}
