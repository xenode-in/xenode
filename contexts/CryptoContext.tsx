"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  setupUserKeyVault, unlockVault, regenerateVault,
  recoverAndResetVault, updateVaultPassword,
} from "@/lib/crypto/keySetup";
import { cacheKeys, loadCachedKeys, clearCachedKeys } from "@/lib/crypto/keyCache";
import { clearLocalDb } from "@/lib/db/local";
import { useSession } from "@/lib/auth/client";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  metadataKey: CryptoKey | null;
  /** Raw private key buffer — only in memory, used for passkey registration */
  privateKeyBuf: ArrayBuffer | null;
  setup: (masterPassword: string, recoveryWords: string) => Promise<void>;
  unlock: (masterPassword: string) => Promise<void>;
  regenerate: (newMasterPassword: string, newRecoveryWords: string) => Promise<void>;
  updatePassword: (currentPassword: string, newMasterPassword: string) => Promise<void>;
  recover: (recoveryWords: string, newMasterPassword: string) => Promise<void>;
  /** Lock vault in memory only (session continues) */
  lock: () => Promise<void>;
  /** Full logout — wipes local DB + clears keys */
  logout: () => Promise<void>;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

export function CryptoProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;

  const [isInitializing, setIsInitializing] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [metadataKey, setMetadataKey] = useState<CryptoKey | null>(null);
  const [privateKeyBuf, setPrivateKeyBuf] = useState<ArrayBuffer | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (isPending) return;

    setPrivateKey(null);
    setPublicKey(null);
    setMetadataKey(null);
    setPrivateKeyBuf(null);
    setIsUnlocked(false);
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
          setIsUnlocked(true);
          return;
        }

        // --- SUBDOMAIN SYNC LOGIC ---
        const hostname = typeof window !== "undefined" ? window.location.hostname : "";
        const isSubdomain = hostname.startsWith("docs.") || hostname.startsWith("admin.");
        
        if (isSubdomain) {
          console.log("[CryptoProvider] Attempting cross-subdomain key sync...");
          const mainUrl = process.env.NEXT_PUBLIC_APP_URL || (hostname.includes("localhost") ? "http://localhost:3000" : "https://xenode.in");
          
          const iframe = document.createElement("iframe");
          iframe.src = `${mainUrl}/sync`;
          iframe.style.display = "none";
          document.body.appendChild(iframe);

          const syncPromise = new Promise<any>((resolve) => {
            const timeout = setTimeout(() => resolve(null), 5000);
            
            const handleSync = async (event: MessageEvent) => {
              if (event.origin !== new URL(mainUrl).origin) return;
              
              if (event.data?.type === "XENODE_SYNC_READY") {
                iframe.contentWindow?.postMessage({ type: "XENODE_GET_KEYS" }, mainUrl);
              }
              
              if (event.data?.type === "XENODE_KEYS_RELAY") {
                clearTimeout(timeout);
                window.removeEventListener("message", handleSync);
                document.body.removeChild(iframe);
                resolve(event.data.keys);
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
            console.log("[CryptoProvider] Successfully synced keys from main domain");
            setPrivateKey(syncedKeys.privateKey);
            setPublicKey(syncedKeys.publicKey);
            setMetadataKey(syncedKeys.metadataKey);
            setIsUnlocked(true);
            await cacheKeys(syncedKeys.privateKey, syncedKeys.publicKey, syncedKeys.metadataKey);
            return;
          }
        }
        // --- END SYNC LOGIC ---

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
          } catch (e: any) {
            if (e.message === "NO_VAULT") {
              setNeedsSetup(true);
              setIsInitializing(false);
              return;
            }
          }
        }

        const res = await fetch("/api/keys/vault");
        if (res.status === 404) setNeedsSetup(true);
      } catch {
        /* network error */
      } finally {
        setIsInitializing(false);
      }
    }
    init();
  }, [userId, isPending]);

  const setup = useCallback(async (masterPassword: string, recoveryWords: string) => {
    const keys = await setupUserKeyVault(masterPassword, recoveryWords);
    setPrivateKey(keys.privateKey); setPublicKey(keys.publicKey);
    setMetadataKey(keys.metadataKey || null); setPrivateKeyBuf(keys.privateKeyBuf);
    setIsUnlocked(true); setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
  }, []);

  const unlock = useCallback(async (masterPassword: string) => {
    const keys = await unlockVault(masterPassword);
    setPrivateKey(keys.privateKey); setPublicKey(keys.publicKey);
    setMetadataKey(keys.metadataKey || null); setPrivateKeyBuf(keys.privateKeyBuf);
    setIsUnlocked(true);
    await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
  }, []);

  const regenerate = useCallback(async (newMasterPassword: string, newRecoveryWords: string) => {
    const keys = await regenerateVault(newMasterPassword, newRecoveryWords);
    setPrivateKey(keys.privateKey); setPublicKey(keys.publicKey);
    setMetadataKey(keys.metadataKey || null); setPrivateKeyBuf(keys.privateKeyBuf);
    setIsUnlocked(true); setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
  }, []);

  const updatePassword = useCallback(async (currentPassword: string, newMasterPassword: string) => {
    const keys = await updateVaultPassword(currentPassword, newMasterPassword);
    setPrivateKey(keys.privateKey); setPublicKey(keys.publicKey);
    setMetadataKey(keys.metadataKey || null); setPrivateKeyBuf(keys.privateKeyBuf);
    setIsUnlocked(true); setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
  }, []);

  const recover = useCallback(async (recoveryWords: string, newMasterPassword: string) => {
    const keys = await recoverAndResetVault(recoveryWords, newMasterPassword);
    setPrivateKey(keys.privateKey); setPublicKey(keys.publicKey);
    setMetadataKey(keys.metadataKey || null); setPrivateKeyBuf(keys.privateKeyBuf);
    setIsUnlocked(true); setNeedsSetup(false);
    await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey);
  }, []);

  // Lock: wipe keys from memory only, DB stays (re-login re-decrypts into RAM)
  const lock = useCallback(async () => {
    setPrivateKey(null); setPublicKey(null); setMetadataKey(null); setPrivateKeyBuf(null);
    setIsUnlocked(false);
    await clearCachedKeys();
  }, []);

  // Logout: wipe keys AND the entire local DB
  const logout = useCallback(async () => {
    setPrivateKey(null); setPublicKey(null); setMetadataKey(null); setPrivateKeyBuf(null);
    setIsUnlocked(false);
    await clearCachedKeys();
    if (userId) await clearLocalDb(userId); // drops IndexedDB + clears lastSync
  }, [userId]);

  return (
    <CryptoContext.Provider value={{
      isInitializing, isUnlocked, needsSetup,
      privateKey, publicKey, metadataKey, privateKeyBuf,
      setup, unlock, regenerate, updatePassword, recover,
      lock, logout,
      isModalOpen, setModalOpen,
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

export function useOptionalCrypto(): CryptoContextType | undefined {
  return useContext(CryptoContext);
}