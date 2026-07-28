"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ProductCryptoProvider,
  useProductCrypto,
} from "@xenode/crypto-react";
import { SecureUnlockOverlay } from "@xenode/ui";
import {
  consumeProductSpaceKey,
  createOneTimeHandoffStore,
  createProductHandoffRequest,
  parseSealedHandoff,
  type PendingHandoff,
  type SealedHandoff,
} from "@xenode/key-handoff";
import {
  getClientPhotosSession,
  type PhotosSessionInfo,
} from "@/lib/client-session";
import { SessionRevocationGuard } from "./SessionRevocationGuard";

const OIDC_ATTEMPT_KEY = "xenode-oidc-attempt:photos";
let oidcRedirectInFlight = false;

type UnlockPayload = {
  transactionId: string;
  sealed: SealedHandoff;
};

export function PhotosKeyAccess({ children }: { children: ReactNode }) {
  const pending = useRef(new Map<string, PendingHandoff>());
  const localReplayStore = useRef(createOneTimeHandoffStore());
  const unwrapHandoff = useCallback(
    async (productId: string, spaceId: string, value: unknown) => {
      const payload = value as Partial<UnlockPayload>;
      if (
        typeof payload.transactionId !== "string" ||
        !payload.sealed
      ) {
        throw new Error("Invalid product key handoff.");
      }
      const request = pending.current.get(payload.transactionId);
      pending.current.delete(payload.transactionId);
      if (
        !request ||
        request.binding.productId !== productId ||
        request.binding.spaceId !== spaceId
      ) {
        throw new Error("Unexpected product key handoff.");
      }
      const sealed = parseSealedHandoff(payload.sealed);
      if (
        sealed.destinationKeyFingerprint !==
        request.destinationKeyFingerprint
      ) {
        throw new Error("Destination key fingerprint mismatch.");
      }
      return consumeProductSpaceKey(
        sealed,
        request.destinationKeyPair.privateKey,
        request.binding,
        localReplayStore.current,
      );
    },
    [],
  );

  return (
    <ProductCryptoProvider
      productId="photos"
      unwrapHandoff={unwrapHandoff}
    >
      <UnlockControl pending={pending}>{children}</UnlockControl>
    </ProductCryptoProvider>
  );
}

function UnlockControl({
  pending,
  children,
}: {
  pending: React.RefObject<Map<string, PendingHandoff>>;
  children: ReactNode;
}) {
  const productCrypto = useProductCrypto();
  const restoreProductKey = productCrypto.restore;
  const [session, setSession] = useState<PhotosSessionInfo | null>(null);
  const [status, setStatus] = useState("Checking product session...");
  const [brokerUrl, setBrokerUrl] = useState<string | null>(null);
  const [interactionUrl, setInteractionUrl] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState(false);
  const [showUnlockOverlay, setShowUnlockOverlay] = useState(false);
  const handoffInFlight = useRef(false);
  const bootstrappedSession = useRef<string | null>(null);
  const accountsOrigin = new URL(
    process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ??
      "https://accounts.xenode.in",
  ).origin;

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
        payload.ephemeralPublicKeyFingerprint !==
          request.destinationKeyFingerprint ||
        sealed.destinationKeyFingerprint !==
          request.destinationKeyFingerprint
      ) {
        throw new Error("Handoff fingerprint mismatch.");
      }
      // Seed the in-memory map so unwrapHandoff resolves this transaction — the
      // map starts empty after a redirect.
      pending.current.set(transactionId, request);
      await productCrypto.unlock(request.binding.spaceId, {
        transactionId,
        sealed,
      } satisfies UnlockPayload);
      setStatus("Photos is ready.");
      setBrokerUrl(null);
      setUnlockError(false);
      handoffInFlight.current = false;
      return true;
    },
    [productCrypto, pending],
  );

  // Keep Photos mounted while Accounts performs the one-time key exchange in a
  // narrowly frameable, exact-origin broker route.
  const startUnlock = useCallback(async () => {
    if (!session) {
      setShowUnlockOverlay(true);
      setStatus("Sign in to Photos first.");
      return;
    }
    if (
      handoffInFlight.current ||
      productCrypto.isUnlocked(session.spaceId)
    ) {
      return;
    }
    handoffInFlight.current = true;
    setShowUnlockOverlay(true);
    setUnlockError(false);
    setStatus("Verifying this Photos session with Xenode Accounts…");
    try {
      const request = await createProductHandoffRequest({
        accountsOrigin,
        accountId: session.accountId,
        clientId: "xenode-photos-web",
        productId: "photos",
        spaceId: session.spaceId,
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
  }, [accountsOrigin, pending, productCrypto, session]);

  // Discover the product session independently from key bootstrap. If these
  // flows share an effect, setSession changes startUnlock and restarts another
  // /api/session request.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const value = await getClientPhotosSession();
        if (!cancelled) {
          setSession(value);
          try {
            sessionStorage.removeItem(OIDC_ATTEMPT_KEY);
          } catch {
            /* storage disabled */
          }
        }
      } catch (error) {
        if (!cancelled) {
          let attempted = false;
          try {
            attempted = sessionStorage.getItem(OIDC_ATTEMPT_KEY) === "1";
          } catch {
            /* storage disabled */
          }
          if (!attempted && !oidcRedirectInFlight) {
            oidcRedirectInFlight = true;
            try {
              sessionStorage.setItem(OIDC_ATTEMPT_KEY, "1");
            } catch {
              /* storage disabled */
            }
            setStatus("Continuing with your Xenode Account…");
            const next = window.location.pathname + window.location.search;
            window.location.replace(
              `/auth/login?next=${encodeURIComponent(next)}`,
            );
            return;
          }
          setStatus(
            error instanceof Error ? error.message : "Session unavailable.",
          );
          setShowUnlockOverlay(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const bootstrapKey = `${session.accountId}:${session.spaceId}`;
    if (bootstrappedSession.current === bootstrapKey) return;
    bootstrappedSession.current = bootstrapKey;
    let cancelled = false;
    setStatus("Restoring Photos encryption…");
    void restoreProductKey(session.spaceId)
      .then((restored) => {
        if (cancelled) return;
        if (restored) {
          setStatus("Photos is ready.");
          setShowUnlockOverlay(false);
          return;
        }
        return startUnlock();
      })
      .catch((error) => {
        if (cancelled) return;
        bootstrappedSession.current = null;
        setUnlockError(true);
        setStatus(
          error instanceof Error
            ? error.message
            : "Could not restore Photos encryption.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [restoreProductKey, session, startUnlock]);

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
        data.type !== "xenode:key-handoff-error" &&
        data.type !== "xenode:key-handoff-interaction-required"
      ) {
        return;
      }
      if (!data.transactionId || !data.state) return;
      const request = pending.current.get(data.transactionId);
      if (!request || request.binding.state !== data.state) return;

      if (data.type === "xenode:key-handoff-interaction-required") {
        const target = new URL(request.brokerUrl);
        target.searchParams.set("mode", "popup");
        setBrokerUrl(null);
        setInteractionUrl(target.toString());
        setStatus("Confirm the unlock in Xenode Accounts.");
        return;
      }

      if (data.type === "xenode:key-handoff-error") {
        pending.current.delete(data.transactionId);
        handoffInFlight.current = false;
        setBrokerUrl(null);
        setInteractionUrl(null);
        setUnlockError(true);
        setStatus(data.message ?? "The secure key exchange failed.");
        return;
      }

      setInteractionUrl(null);
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

  const unlocked = session
    ? productCrypto.isUnlocked(session.spaceId)
    : false;
  if (unlocked) {
    return (
      <>
        <SessionRevocationGuard sessionId={session!.sessionId} />
        {children}
      </>
    );
  }
  return (
    <>
      {children}
      {showUnlockOverlay ? (
        <SecureUnlockOverlay
          productName="Photos"
          status={status}
          brokerUrl={brokerUrl}
          onOpenAccounts={
            interactionUrl
              ? () => {
                  window.open(
                    interactionUrl,
                    "xenode-vault-unlock",
                    "popup=yes,width=620,height=760",
                  );
                }
              : undefined
          }
          error={unlockError}
          onRetry={
            session
              ? () => {
                  handoffInFlight.current = false;
                  bootstrappedSession.current = null;
                  setBrokerUrl(null);
                  setInteractionUrl(null);
                  setUnlockError(false);
                  void startUnlock();
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}
