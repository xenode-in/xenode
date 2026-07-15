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
import {
  consumeProductSpaceKey,
  createOneTimeHandoffStore,
  createProductHandoffRequest,
  parseSealedHandoff,
  type HandoffBinding,
  type PendingHandoff,
  type SealedHandoff,
} from "@xenode/key-handoff";

type SessionInfo = {
  accountId: string;
  spaceId: string;
  productId: "photos";
};
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
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState("Checking product session...");
  const popup = useRef<Window | null>(null);
  const accountsOrigin = new URL(
    process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ??
      "https://accounts.xenode.in",
  ).origin;

  useEffect(() => {
    void fetch("/api/session", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign in to Photos first.");
        return response.json() as Promise<SessionInfo>;
      })
      .then((value) => {
        setSession(value);
        setStatus("Photos encryption key is locked.");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Session unavailable.");
      });
  }, []);

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
      await productCrypto.unlock(request.binding.spaceId, {
        transactionId,
        sealed,
      } satisfies UnlockPayload);
      popup.current?.close();
      setStatus("Photos encryption key unlocked in memory.");
      return true;
    },
    [productCrypto],
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

  async function startUnlock() {
    if (!session) {
      setStatus("Sign in to Photos first.");
      return;
    }
    try {
      const request = await createProductHandoffRequest({
        accountsOrigin,
        accountId: session.accountId,
        clientId: "xenode-photos-web",
        productId: "photos",
        spaceId: session.spaceId,
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
        throw new Error("Allow the Accounts popup to unlock Photos.");
      }
      setStatus("Approve the one-time handoff in Accounts.");
      void (async () => {
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
      })().catch((error: unknown) => {
        pending.current.delete(request.binding.transactionId);
        setStatus(error instanceof Error ? error.message : "Handoff failed.");
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start handoff.");
    }
  }

  const unlocked = session
    ? productCrypto.isUnlocked(session.spaceId)
    : false;
  return (
    <>
      <aside
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "10px 32px",
          borderBottom: "1px solid #27272a",
        }}
      >
        <button
          type="button"
          disabled={!session || unlocked}
          onClick={() => void startUnlock()}
        >
          {unlocked ? "Encryption unlocked" : "Unlock encryption"}
        </button>
        <span role="status" style={{ color: "#a1a1aa" }}>{status}</span>
        {!session ? <a href="/auth/login">Sign in</a> : null}
      </aside>
      {children}
    </>
  );
}
