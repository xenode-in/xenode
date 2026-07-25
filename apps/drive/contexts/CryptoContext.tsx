"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ProductCryptoProvider,
  useProductCrypto,
  loadPersistedKey,
  savePersistedKey,
  deletePersistedKey,
} from "@xenode/crypto-react";
import {
  consumeProductKeyBundle,
  createOneTimeHandoffStore,
  createProductHandoffRequest,
  parseSealedHandoff,
  type PendingHandoff,
  type SealedHandoff,
} from "@xenode/key-handoff";
import { personalSpaceId } from "@xenode/spaces/ids";
import { clearLocalDb } from "@/lib/db/local";
import { clearThumbnailMemoryCache } from "@/lib/thumbnails/memoryCache";
import { deriveDriveMetadataKey } from "@/lib/crypto/productKeys";

interface CryptoContextType {
  isInitializing: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  metadataKey: CryptoKey | null;
  privateKeyBuf: ArrayBuffer | null;
  lock: () => Promise<void>;
  logout: () => Promise<void>;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

type UnlockPayload = {
  transactionId: string;
  sealed: SealedHandoff;
};

type ImportedSharingKeys = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  metadataKey: CryptoKey;
};

// The product-space key persists via the crypto-react ProductKeyStore cache.
// Drive's gate also needs the RSA sharing keypair + derived metadata key, which
// aren't recoverable from the (non-extractable) product key — so persist those
// three non-extractable CryptoKeys too, keyed by spaceId, for silent re-unlock.
const AUX_PRIVATE = "drive-sharing-private";
const AUX_PUBLIC = "drive-sharing-public";
const AUX_METADATA = "drive-metadata";

async function persistSharingKeys(
  spaceId: string,
  keys: ImportedSharingKeys,
): Promise<void> {
  await Promise.all([
    savePersistedKey(AUX_PRIVATE, spaceId, keys.privateKey),
    savePersistedKey(AUX_PUBLIC, spaceId, keys.publicKey),
    savePersistedKey(AUX_METADATA, spaceId, keys.metadataKey),
  ]);
}

async function loadSharingKeys(
  spaceId: string,
): Promise<ImportedSharingKeys | null> {
  const [privateKey, publicKey, metadataKey] = await Promise.all([
    loadPersistedKey(AUX_PRIVATE, spaceId),
    loadPersistedKey(AUX_PUBLIC, spaceId),
    loadPersistedKey(AUX_METADATA, spaceId),
  ]);
  if (!privateKey || !publicKey || !metadataKey) return null;
  return { privateKey, publicKey, metadataKey };
}

async function forgetSharingKeys(spaceId: string): Promise<void> {
  await Promise.all([
    deletePersistedKey(AUX_PRIVATE, spaceId),
    deletePersistedKey(AUX_PUBLIC, spaceId),
    deletePersistedKey(AUX_METADATA, spaceId),
  ]);
}

const CryptoContext = createContext<CryptoContextType | undefined>(undefined);

const RSA_PARAMS: RsaHashedImportParams = {
  name: "RSA-OAEP",
  hash: "SHA-256",
};

async function importAndVerifySharingKeys(
  privateKeyPkcs8: Uint8Array,
  publicKeySpki: Uint8Array,
  productSpaceKey: Uint8Array,
  spaceId: string,
): Promise<ImportedSharingKeys> {
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey(
      "pkcs8",
      privateKeyPkcs8 as BufferSource,
      RSA_PARAMS,
      false,
      ["decrypt"],
    ),
    crypto.subtle.importKey(
      "spki",
      publicKeySpki as BufferSource,
      RSA_PARAMS,
      false,
      ["encrypt"],
    ),
  ]);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    challenge as BufferSource,
  );
  const opened = new Uint8Array(
    await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrapped),
  );
  if (!opened.every((value, index) => value === challenge[index])) {
    throw new Error("Sharing keypair verification failed.");
  }
  try {
    const metadataKey = await deriveDriveMetadataKey(productSpaceKey, spaceId);
    return { privateKey, publicKey, metadataKey };
  } finally {
    challenge.fill(0);
    opened.fill(0);
  }
}

export function CryptoProvider({
  children,
  initialUserId,
}: {
  children: ReactNode;
  initialUserId?: string | null;
}) {
  const accountId = initialUserId ?? "";
  const spaceId = accountId ? personalSpaceId(accountId) : "";
  const pending = useRef(new Map<string, PendingHandoff>());
  const replayStore = useRef(createOneTimeHandoffStore());
  const [sharingKeys, setSharingKeys] = useState<ImportedSharingKeys | null>(null);

  const unwrapHandoff = useCallback(
    async (productId: string, requestedSpaceId: string, value: unknown) => {
      const payload = value as Partial<UnlockPayload>;
      if (typeof payload.transactionId !== "string" || !payload.sealed) {
        throw new Error("Invalid Drive key handoff.");
      }
      const request = pending.current.get(payload.transactionId);
      pending.current.delete(payload.transactionId);
      if (
        !request ||
        productId !== "drive" ||
        requestedSpaceId !== spaceId ||
        request.binding.productId !== productId ||
        request.binding.spaceId !== requestedSpaceId
      ) {
        throw new Error("Unexpected Drive key handoff.");
      }
      const sealed = parseSealedHandoff(payload.sealed);
      if (
        sealed.destinationKeyFingerprint !== request.destinationKeyFingerprint
      ) {
        throw new Error("Destination key fingerprint mismatch.");
      }
      const bundle = await consumeProductKeyBundle(
        sealed,
        request.destinationKeyPair.privateKey,
        request.binding,
        replayStore.current,
      );
      if (!bundle.sharingPrivateKeyPkcs8 || !bundle.sharingPublicKeySpki) {
        bundle.productSpaceKey.fill(0);
        throw new Error("Drive handoff is missing sharing keys.");
      }
      try {
        const keys = await importAndVerifySharingKeys(
          bundle.sharingPrivateKeyPkcs8,
          bundle.sharingPublicKeySpki,
          bundle.productSpaceKey,
          requestedSpaceId,
        );
        setSharingKeys(keys);
        // Persist the sharing keypair + metadata key so a reload auto-unlocks
        // (the product key itself is persisted by ProductCryptoProvider).
        await persistSharingKeys(requestedSpaceId, keys);
        return bundle.productSpaceKey;
      } finally {
        bundle.sharingPrivateKeyPkcs8.fill(0);
      }
    },
    [spaceId],
  );

  return (
    <ProductCryptoProvider productId="drive" unwrapHandoff={unwrapHandoff}>
      <DriveKeyAccess
        accountId={accountId}
        spaceId={spaceId}
        pending={pending}
        sharingKeys={sharingKeys}
        setSharingKeys={setSharingKeys}
        clearSharingKeys={() => setSharingKeys(null)}
      >
        {children}
      </DriveKeyAccess>
    </ProductCryptoProvider>
  );
}

function DriveKeyAccess({
  accountId,
  spaceId,
  pending,
  sharingKeys,
  setSharingKeys,
  clearSharingKeys,
  children,
}: {
  accountId: string;
  spaceId: string;
  pending: React.RefObject<Map<string, PendingHandoff>>;
  sharingKeys: ImportedSharingKeys | null;
  setSharingKeys: (keys: ImportedSharingKeys) => void;
  clearSharingKeys: () => void;
  children: ReactNode;
}) {
  const productCrypto = useProductCrypto();
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState("Drive encryption is locked.");
  const [isModalOpen, setModalOpen] = useState(false);
  const accountsOrigin = new URL(
    process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
  ).origin;
  const isUnlocked =
    Boolean(spaceId && sharingKeys) && productCrypto.isUnlocked(spaceId);

  // Silent auto-unlock from the persisted caches on mount: restore the product
  // key (ProductCryptoProvider) + the sharing/metadata keys, so a reload never
  // re-triggers the Accounts handoff popup.
  useEffect(() => {
    if (!accountId || !spaceId) return;
    let cancelled = false;
    void (async () => {
      const restoredProduct = await productCrypto.restore(spaceId);
      if (!restoredProduct || cancelled) return;
      const keys = await loadSharingKeys(spaceId);
      if (cancelled || !keys) return;
      setSharingKeys(keys);
      setStatus("Drive encryption keys are unlocked in memory.");
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, spaceId, productCrypto, setSharingKeys]);

  const consumeRequest = useCallback(
    async (request: PendingHandoff): Promise<boolean> => {
      const transactionId = request.binding.transactionId;
      const response = await fetch(
        `/api/key-handoffs/${encodeURIComponent(transactionId)}/consume`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.binding),
        },
      );
      if (response.status === 410) return false;
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        ciphertext?: string;
        ephemeralPublicKeyFingerprint?: string;
      };
      if (!response.ok || !payload.ciphertext) {
        throw new Error(payload.error ?? "Handoff consumption failed.");
      }
      const sealed = parseSealedHandoff(payload.ciphertext);
      if (
        payload.ephemeralPublicKeyFingerprint !== request.destinationKeyFingerprint ||
        sealed.destinationKeyFingerprint !== request.destinationKeyFingerprint
      ) {
        throw new Error("Handoff fingerprint mismatch.");
      }
      await productCrypto.unlock(spaceId, { transactionId, sealed } satisfies UnlockPayload);
      popup.current?.close();
      setStatus("Drive encryption keys are unlocked in memory.");
      setModalOpen(false);
      return true;
    },
    [productCrypto, spaceId],
  );

  useEffect(() => {
    async function receive(event: MessageEvent) {
      const data = event.data as {
        type?: unknown;
        transactionId?: unknown;
        state?: unknown;
      };
      if (
        event.origin !== accountsOrigin ||
        event.source !== popup.current ||
        data.type !== "xenode:key-handoff-ready" ||
        typeof data.transactionId !== "string" ||
        typeof data.state !== "string"
      ) {
        return;
      }
      const request = pending.current.get(data.transactionId);
      if (!request || request.binding.state !== data.state) return;
      setStatus("Consuming the one-time key handoff...");
      try {
        await consumeRequest(request);
      } catch (error) {
        pending.current.delete(data.transactionId);
        setStatus(error instanceof Error ? error.message : "Handoff failed.");
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [accountsOrigin, consumeRequest, pending]);

  const startUnlock = useCallback(async () => {
    if (!accountId || !spaceId) {
      setStatus("Sign in to Drive first.");
      return;
    }
    try {
      const request = await createProductHandoffRequest({
        accountsOrigin,
        accountId,
        clientId: "xenode-drive-web",
        productId: "drive",
        spaceId,
        destinationOrigin: window.location.origin,
      });
      pending.current.set(request.binding.transactionId, request);
      popup.current = window.open(
        request.brokerUrl,
        "xenode-key-handoff",
        "popup,width=680,height=760",
      );
      if (!popup.current) {
        pending.current.delete(request.binding.transactionId);
        throw new Error("Allow the Accounts popup to unlock Drive.");
      }
      setStatus("Approve the one-time handoff in Accounts.");
      const deadline = Date.now() + 2 * 60 * 1000;
      while (
        Date.now() < deadline &&
        pending.current.has(request.binding.transactionId)
      ) {
        if (await consumeRequest(request)) return;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      if (pending.current.has(request.binding.transactionId)) {
        throw new Error("Key handoff expired.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start handoff.");
    }
  }, [accountId, accountsOrigin, consumeRequest, pending, spaceId]);

  const lock = useCallback(async () => {
    await productCrypto.lock(spaceId || undefined);
    if (spaceId) await forgetSharingKeys(spaceId);
    clearSharingKeys();
    clearThumbnailMemoryCache();
    setStatus("Drive encryption is locked.");
  }, [clearSharingKeys, productCrypto, spaceId]);

  const logout = useCallback(async () => {
    await lock();
    if (accountId) await clearLocalDb(accountId);
  }, [accountId, lock]);

  const value: CryptoContextType = {
    isInitializing: false,
    isUnlocked,
    needsSetup: false,
    privateKey: sharingKeys?.privateKey ?? null,
    publicKey: sharingKeys?.publicKey ?? null,
    metadataKey: sharingKeys?.metadataKey ?? null,
    privateKeyBuf: null,
    lock,
    logout,
    isModalOpen,
    setModalOpen,
  };

  return (
    <CryptoContext.Provider value={value}>
      {!isUnlocked ? (
        <aside className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2 text-sm">
          <span role="status" className="text-muted-foreground">{status}</span>
          <div className="flex items-center gap-3">
            <a
              href={`${accountsOrigin}/security/vault`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Manage Vault
            </a>
            <button
              type="button"
              onClick={() => void startUnlock()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Unlock encryption
            </button>
          </div>
        </aside>
      ) : null}
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
