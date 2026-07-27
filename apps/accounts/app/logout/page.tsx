"use client";

import { useEffect, useState } from "react";
import { clearCachedAccountRootKey } from "@/lib/ark-cache";

type CleanupTarget = {
  productId: "drive" | "photos";
  url: string;
};

async function finishLogout(
  transaction: string | null,
  signOutAccounts: boolean,
) {
  await clearCachedAccountRootKey().catch(() => undefined);
  if (signOutAccounts) {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  }
  if (transaction) {
    await fetch("/api/account/logout/complete", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction }),
    }).catch(() => undefined);
  }
  window.location.replace("/login?signed_out=1");
}

export default function LogoutPage() {
  const [cleanupTargets, setCleanupTargets] = useState<CleanupTarget[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = new URL(window.location.href);
      const transaction = url.searchParams.get("transaction");
      if (!transaction) {
        const response = await fetch("/api/account/logout/start", {
          method: "POST",
          credentials: "include",
        }).catch(() => null);
        if (!response?.ok) {
          await finishLogout(null, true);
          return;
        }
        const payload = (await response.json()) as { logoutUrl: string };
        window.location.replace(payload.logoutUrl);
        return;
      }

      const response = await fetch("/api/account/logout/prepare", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction }),
      }).catch(() => null);
      if (!response?.ok) {
        await finishLogout(transaction, true);
        return;
      }
      const payload = (await response.json()) as {
        cleanupUrls: CleanupTarget[];
        signOutAccounts: boolean;
      };
      if (cancelled) return;
      setCleanupTargets(payload.cleanupUrls);

      const pending = new Set(
        payload.cleanupUrls.map((target) => target.productId),
      );
      const allowedOrigins = new Set(
        payload.cleanupUrls.map((target) => new URL(target.url).origin),
      );
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 3500);
        const onMessage = (event: MessageEvent) => {
          if (
            !allowedOrigins.has(event.origin) ||
            event.data?.type !== "xenode:logout-cleanup" ||
            !pending.has(event.data.productId)
          ) {
            return;
          }
          pending.delete(event.data.productId);
          if (!pending.size) {
            window.clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            resolve();
          }
        };
        window.addEventListener("message", onMessage);
      });
      if (!cancelled) {
        await finishLogout(transaction, payload.signOutAccounts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <p className="eyebrow">Xenode Account</p>
        <h1 style={{ fontSize: 28 }}>Signing you out…</h1>
        <p className="lede">
          Closing Drive, Photos, and your account session in this browser.
        </p>
        {cleanupTargets.map((target) => (
          <iframe
            key={target.productId}
            src={target.url}
            title={`Clear ${target.productId} session`}
            hidden
            sandbox="allow-scripts allow-same-origin"
          />
        ))}
      </section>
    </main>
  );
}
