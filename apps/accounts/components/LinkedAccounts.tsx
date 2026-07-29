"use client";

import { useState } from "react";
import { connectedDateLabel } from "@/lib/presentation";

type ProviderId = "google" | "github";
type LinkedAccount = {
  id: string;
  accountId: string;
  providerId: string;
  scopes: string[];
  createdAt: string;
};

const PROVIDERS: Array<{ id: ProviderId; name: string }> = [
  { id: "google", name: "Google" },
  { id: "github", name: "GitHub" },
];

export function LinkedAccounts({
  configured,
  hasCredential,
  initialAccounts,
}: {
  configured: Record<ProviderId, boolean>;
  hasCredential: boolean;
  initialAccounts: LinkedAccount[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  async function load() {
    const response = await fetch("/api/auth/list-accounts", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      setError(true);
      setStatus("Could not load sign-in methods.");
      return;
    }
    const payload = (await response.json()) as LinkedAccount[];
    setAccounts(payload.filter((account) => account.providerId !== "credential"));
  }

  async function connect(provider: ProviderId) {
    setBusy(provider);
    setError(false);
    const response = await fetch("/api/auth/link-social", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        callbackURL: `${window.location.origin}/linked-accounts?linked=${provider}`,
        errorCallbackURL: `${window.location.origin}/linked-accounts?error=${provider}`,
        disableRedirect: true,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      url?: string;
    } | null;
    if (!response.ok || !payload?.url) {
      setBusy(null);
      setError(true);
      setStatus(`Could not connect ${provider === "google" ? "Google" : "GitHub"}.`);
      return;
    }
    window.location.assign(payload.url);
  }

  async function disconnect(provider: ProviderId, accountId: string) {
    const remainingMethods =
      accounts.filter((account) => account.providerId !== provider).length +
      (hasCredential ? 1 : 0);
    if (remainingMethods === 0) {
      setError(true);
      setStatus("Add another sign-in method before disconnecting this one.");
      return;
    }
    setBusy(provider);
    setError(false);
    const response = await fetch("/api/auth/unlink-account", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: provider, accountId }),
    });
    setBusy(null);
    if (!response.ok) {
      setError(true);
      setStatus("That sign-in method could not be disconnected.");
      return;
    }
    setStatus(`${provider === "google" ? "Google" : "GitHub"} disconnected.`);
    await load();
  }

  return (
    <>
      {PROVIDERS.map(({ id, name }) => {
        const linked = accounts.find((account) => account.providerId === id);
        return (
          <section className="card" style={{ marginTop: 24 }} key={id}>
            <div className="section-heading" style={{ marginTop: 0 }}>
              <div>
                <h2>{name}</h2>
                <p className="muted">
                  Verified OAuth identity for signing in to Xenode.
                </p>
              </div>
              <span className="badge">
                {linked ? "Connected" : configured[id] ? "Available" : "Not configured"}
              </span>
            </div>
            {linked ? (
              <>
                <p className="fine-print">
                  Connected {connectedDateLabel(linked.createdAt)}.
                  Granted scopes: {linked.scopes.join(", ") || "identity"}.
                </p>
                <button
                  className="button button-danger"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void disconnect(id, linked.accountId)}
                >
                  Disconnect {name}
                </button>
              </>
            ) : (
              <button
                className="button"
                type="button"
                disabled={busy !== null || !configured[id]}
                onClick={() => void connect(id)}
              >
                {busy === id ? `Opening ${name}…` : `Connect ${name}`}
              </button>
            )}
          </section>
        );
      })}
      {status ? (
        <p
          className={`status${error ? " status-error" : ""}`}
          style={{ marginTop: 16 }}
          role="status"
        >
          {status}
        </p>
      ) : null}
    </>
  );
}
