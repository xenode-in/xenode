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
  clearPersistedKeys,
  clearPendingHandoff,
} from "@xenode/crypto-react";
import { SecureUnlockOverlay } from "@xenode/ui";
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
import { SessionRevocationGuard } from "@/components/auth/SessionRevocationGuard";

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

async function clearLegacySharingKeys(): Promise<void> {
  await Promise.all([
    clearPersistedKeys(AUX_PRIVATE),
    clearPersistedKeys(AUX_PUBLIC),
    clearPersistedKeys(AUX_METADATA),
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
  initialSessionId,
}: {
  children: ReactNode;
  initialUserId?: string | null;
  initialSessionId?: string | null;
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
        return bundle.productSpaceKey;
      } finally {
        bundle.sharingPrivateKeyPkcs8.fill(0);
      }
    },
    [spaceId],
  );

  return (
    <ProductCryptoProvider productId="drive" unwrapHandoff={unwrapHandoff}>
      {initialSessionId ? (
        <SessionRevocationGuard sessionId={initialSessionId} />
      ) : null}
      <DriveKeyAccess
        accountId={accountId}
        spaceId={spaceId}
        pending={pending}
        sharingKeys={sharingKeys}
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
  clearSharingKeys,
  children,
}: {
  accountId: string;
  spaceId: string;
  pending: React.RefObject<Map<string, PendingHandoff>>;
  sharingKeys: ImportedSharingKeys | null;
  clearSharingKeys: () => void;
  children: ReactNode;
}) {
  const productCrypto = useProductCrypto();
  const unlockProductKey = productCrypto.unlock;
  const [status, setStatus] = useState("Restoring Drive encryption…");
  const [brokerUrl, setBrokerUrl] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState(false);
  const handoffInFlight = useRef(false);
  const [isModalOpen, setModalOpen] = useState(false);
  const accountsOrigin = new URL(
    process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in",
  ).origin;
  const isUnlocked =
    Boolean(spaceId && sharingKeys) && productCrypto.isUnlocked(spaceId);

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
      if (response.status === 410) {
        throw new Error("The one-time handoff expired. Please try again.");
      }
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
      // Seed the in-memory map so unwrapHandoff (which reads `pending`) resolves
      // this transaction — after a redirect the map starts empty.
      pending.current.set(transactionId, request);
      await unlockProductKey(spaceId, { transactionId, sealed } satisfies UnlockPayload);
      setStatus("Drive is ready.");
      setBrokerUrl(null);
      setUnlockError(false);
      handoffInFlight.current = false;
      setModalOpen(false);
      return true;
    },
    [unlockProductKey, spaceId, pending],
  );

  // Keep Drive mounted while Accounts performs the one-time key exchange in a
  // narrowly frameable, exact-origin broker route.
  const startUnlock = useCallback(async () => {
    if (!accountId || !spaceId) {
      setStatus("Sign in to Drive first.");
      return;
    }
    if (handoffInFlight.current || isUnlocked) return;
    handoffInFlight.current = true;
    setUnlockError(false);
    setStatus("Verifying this Drive session with Xenode Accounts…");
    try {
      const request = await createProductHandoffRequest({
        accountsOrigin,
        accountId,
        clientId: "xenode-drive-web",
        productId: "drive",
        spaceId,
        destinationOrigin: window.location.origin,
        mode: "iframe",
      });
      pending.current.set(request.binding.transactionId, request);
      setStatus("Securely exchanging a one-time encrypted key…");
      setBrokerUrl(request.brokerUrl);
    } catch (error) {
      handoffInFlight.current = false;
      setUnlockError(true);
      setStatus(error instanceof Error ? error.message : "Could not start handoff.");
    }
  }, [accountId, accountsOrigin, isUnlocked, pending, spaceId]);

  useEffect(() => {
    if (!accountId || !spaceId || isUnlocked) return;
    let cancelled = false;
    void (async () => {
      await clearLegacySharingKeys();
      if (cancelled) return;
      await startUnlock();
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, isUnlocked, spaceId, startUnlock]);

  useEffect(() => {
    function receiveHandoff(event: MessageEvent) {
      if (event.origin !== accountsOrigin) return;
      const data = event.data as {
        type?: string;
        transactionId?: string;
        state?: string;
        message?: string;
      };
      if (
        data.type !== "xenode:key-handoff-ready" &&
        data.type !== "xenode:key-handoff-error"
      ) {
        return;
      }
      if (!data.transactionId || !data.state) return;
      const request = pending.current.get(data.transactionId);
      if (!request || request.binding.state !== data.state) return;

      if (data.type === "xenode:key-handoff-error") {
        pending.current.delete(data.transactionId);
        handoffInFlight.current = false;
        setBrokerUrl(null);
        setUnlockError(true);
        setStatus(data.message ?? "The secure key exchange failed.");
        return;
      }

      setStatus("Opening the one-time encrypted handoff…");
      void consumeRequest(request).catch((error) => {
        pending.current.delete(data.transactionId!);
        handoffInFlight.current = false;
        setBrokerUrl(null);
        setUnlockError(true);
        setStatus(error instanceof Error ? error.message : "Handoff failed.");
      });
    }

    window.addEventListener("message", receiveHandoff);
    return () => window.removeEventListener("message", receiveHandoff);
  }, [accountsOrigin, consumeRequest, pending]);

  const lock = useCallback(async () => {
    await productCrypto.lock(spaceId || undefined);
    await clearLegacySharingKeys();
    await clearPendingHandoff("drive");
    pending.current.clear();
    handoffInFlight.current = false;
    setBrokerUrl(null);
    setUnlockError(false);
    clearSharingKeys();
    clearThumbnailMemoryCache();
    setStatus("Drive encryption is locked.");
  }, [clearSharingKeys, pending, productCrypto, spaceId]);

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
      {children}
      {!isUnlocked ? (
        <SecureUnlockOverlay
          productName="Drive"
          status={status}
          brokerUrl={brokerUrl}
          error={unlockError}
          onRetry={() => {
            handoffInFlight.current = false;
            setBrokerUrl(null);
            setUnlockError(false);
            void startUnlock();
          }}
        />
      ) : null}
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
