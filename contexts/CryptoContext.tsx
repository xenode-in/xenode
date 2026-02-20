"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { setupUserKeyVault, unlockVault } from "@/lib/crypto/keySetup";

interface CryptoContextType {
  /** true once the vault has been unlocked this session */
  isUnlocked: boolean;
  /** true if the server has no vault for this user yet (first time) */
  needsSetup: boolean;
  /** In-memory RSA private key — null until unlocked */
  privateKey: CryptoKey | null;
  /** In-memory RSA public key — null until unlocked */
  publicKey: CryptoKey | null;
  /**
   * Unlock the vault with the user's encryption password.
   * Throws "WRONG_PASSWORD" if the password is incorrect.
   */
  unlock: (password: string) => Promise<void>;
  /**
   * Set up a brand-new vault (first-time users).
   * Generates a keypair, encrypts the private key, saves to server.
   */
  setup: (password: string) => Promise<void>;
  /** Lock the in-memory keys (e.g. on logout) */
  lock: () => void;
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

export function CryptoProvider({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);

  /** On mount, check if the user has a vault (to show setup vs. unlock prompt) */
  useEffect(() => {
    fetch("/api/keys/vault")
      .then((res) => {
        if (res.status === 404) setNeedsSetup(true);
        // 200 = vault exists, user needs to unlock
        // 401 = not logged in — ignore, auth guard handles this
      })
      .catch(() => {
        // network error — assume vault check will be retried on next mount
      });
  }, []);

  const unlock = useCallback(async (password: string) => {
    const keys = await unlockVault(password);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
  }, []);

  const setup = useCallback(async (password: string) => {
    const keys = await setupUserKeyVault(password);
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
    setIsUnlocked(true);
    setNeedsSetup(false);
  }, []);

  const lock = useCallback(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setIsUnlocked(false);
  }, []);

  return (
    <CryptoContext.Provider
      value={{
        isUnlocked,
        needsSetup,
        privateKey,
        publicKey,
        unlock,
        setup,
        lock,
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
