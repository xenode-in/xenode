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
  savePendingHandoff,
  loadPendingHandoff,
  clearPendingHandoff,
} from "@xenode/crypto-react";
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

// Loop guard + document-scoped dedupe for the redirect handoff (see Drive).
const HANDOFF_ATTEMPT_KEY = "xenode-handoff-attempt:photos";
let handoffRedirectInFlight = false;

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
  const [session, setSession] = useState<PhotosSessionInfo | null>(null);
  const [status, setStatus] = useState("Checking product session...");
  const bootstrappedSession = useRef<string | null>(null);

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
      setStatus("Photos encryption key unlocked in memory.");
      return true;
    },
    [productCrypto, pending],
  );

  // Redirect-based handoff (zero-click) — see Drive's CryptoContext.
  const startUnlock = useCallback(async () => {
    if (!session) {
      setStatus("Sign in to Photos first.");
      return;
    }
    if (handoffRedirectInFlight) return;
    handoffRedirectInFlight = true;
    try {
      const accountsOrigin = new URL(
        process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ??
          "https://accounts.xenode.in",
      ).origin;
      const request = await createProductHandoffRequest({
        accountsOrigin,
        accountId: session.accountId,
        clientId: "xenode-photos-web",
        productId: "photos",
        spaceId: session.spaceId,
        destinationOrigin: window.location.origin,
        mode: "redirect",
        returnPath: window.location.pathname + window.location.search,
      });
      await savePendingHandoff("photos", request);
      try {
        sessionStorage.setItem(HANDOFF_ATTEMPT_KEY, "1");
      } catch {
        /* storage disabled */
      }
      setStatus("Unlocking with your Xenode Account…");
      window.location.assign(request.brokerUrl);
    } catch (error) {
      handoffRedirectInFlight = false;
      setStatus(error instanceof Error ? error.message : "Could not start handoff.");
    }
  }, [session]);

  // Discover the product session independently from key bootstrap. If these
  // flows share an effect, setSession changes startUnlock and restarts another
  // /api/session request.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const value = await getClientPhotosSession();
        if (!cancelled) setSession(value);
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Session unavailable.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // For a known session: consume a returning handoff, restore from cache, or
  // auto-redirect once to unlock seamlessly.
  useEffect(() => {
    if (!session) return;
    const bootstrapKey = `${session.accountId}:${session.spaceId}`;
    if (bootstrappedSession.current === bootstrapKey) return;
    bootstrappedSession.current = bootstrapKey;

    let cancelled = false;
    void (async () => {
      // (1) Return leg — consume a redirect handoff if we came back with one.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
      const returnedTx = hash.get("xenode-handoff");
      const returnedState = hash.get("xenode-state");
      if (returnedTx && returnedState) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        const persisted = (await loadPendingHandoff(
          "photos",
        )) as PendingHandoff | null;
        await clearPendingHandoff("photos");
        if (
          persisted &&
          persisted.binding.transactionId === returnedTx &&
          persisted.binding.state === returnedState
        ) {
          try {
            await consumeRequest(persisted);
            try {
              sessionStorage.removeItem(HANDOFF_ATTEMPT_KEY);
            } catch {
              /* ignore */
            }
          } catch (error) {
            if (!cancelled) {
              setStatus(
                error instanceof Error ? error.message : "Handoff failed.",
              );
            }
          }
          return;
        }
      }

      // (2) Silent restore from the persisted key cache.
      const restored = await productCrypto.restore(session.spaceId);
      if (restored && !cancelled) {
        setStatus("Photos encryption key unlocked.");
        try {
          sessionStorage.removeItem(HANDOFF_ATTEMPT_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      if (cancelled) return;

      // (3) Still locked — auto-redirect once per session.
      let attempted = false;
      try {
        attempted = sessionStorage.getItem(HANDOFF_ATTEMPT_KEY) === "1";
      } catch {
        /* storage disabled */
      }
      if (!attempted) {
        await startUnlock();
      } else {
        setStatus("Photos encryption key is locked.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, productCrypto, consumeRequest, startUnlock]);

  const unlocked = session
    ? productCrypto.isUnlocked(session.spaceId)
    : false;
  if (unlocked) return <>{children}</>;
  return (
    <>
      <aside className="flex items-center gap-3 border-b border-border bg-card px-6 py-2.5 text-sm">
        <button
          type="button"
          disabled={!session}
          onClick={() => {
            try {
              sessionStorage.removeItem(HANDOFF_ATTEMPT_KEY);
            } catch {
              /* ignore */
            }
            void startUnlock();
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Unlock encryption
        </button>
        <span role="status" className="text-muted-foreground">
          {status}
        </span>
        {!session ? (
          <a href="/auth/login" className="ml-auto text-primary hover:underline">
            Sign in
          </a>
        ) : null}
      </aside>
      {children}
    </>
  );
}
