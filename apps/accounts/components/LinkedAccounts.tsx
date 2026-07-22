"use client";

import { useState } from "react";

type LinkedAccount = {
  id: string;
  accountId: string;
  providerId: string;
  scopes: string[];
  createdAt: string;
};

export function LinkedAccounts({ googleConfigured, initialAccounts }: { googleConfigured: boolean; initialAccounts: LinkedAccount[] }) {
  const [accounts, setAccounts] = useState<LinkedAccount[]>(initialAccounts);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  async function load() {
    const response = await fetch("/api/auth/list-accounts", { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      setError(true);
      setStatus("Could not load linked accounts.");
      return;
    }
    const payload = (await response.json()) as LinkedAccount[];
    setAccounts(payload.filter((account) => account.providerId !== "credential"));
    setStatus("");
  }

  const google = accounts.find((account) => account.providerId === "google");

  async function connectGoogle() {
    setBusy(true);
    setError(false);
    const response = await fetch("/api/auth/link-social", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${window.location.origin}/linked-accounts?linked=google`,
        errorCallbackURL: `${window.location.origin}/linked-accounts?error=google`,
        disableRedirect: true,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { url?: string } | null;
    if (!response.ok || !payload?.url) {
      setBusy(false);
      setError(true);
      setStatus("Google could not be connected. Check the connector configuration and try again.");
      return;
    }
    window.location.assign(payload.url);
  }

  async function disconnectGoogle() {
    if (!google) return;
    setBusy(true);
    setError(false);
    const response = await fetch("/api/auth/unlink-account", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "google", accountId: google.accountId }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(true);
      setStatus("Google could not be disconnected. Sign in again and retry.");
      return;
    }
    setStatus("Google disconnected.");
    await load();
  }

  return (
    <section className="card" style={{ marginTop: 32 }}>
      <div className="section-heading" style={{ marginTop: 0 }}>
        <div><h2>Google</h2><p className="muted">Profile connector through a verified OAuth link.</p></div>
        <span className="badge">{google ? "Connected" : googleConfigured ? "Available" : "Not configured"}</span>
      </div>
      {google ? (
        <>
          <p className="fine-print">Connected {new Date(google.createdAt).toLocaleDateString()}. Granted scopes: {google.scopes.join(", ") || "profile"}.</p>
          <button className="button button-danger" type="button" disabled={busy} onClick={() => void disconnectGoogle()}>Disconnect Google</button>
        </>
      ) : (
        <button className="button" type="button" disabled={busy || !googleConfigured} onClick={() => void connectGoogle()}>{busy ? "Opening Google…" : "Connect Google"}</button>
      )}
      {status ? <p className={`status${error ? " status-error" : ""}`} style={{ marginTop: 16 }} role="status">{status}</p> : null}
      <p className="fine-print" style={{ marginBottom: 0 }}>Xenode uses Better Auth’s OAuth link flow directly; no Google API SDK is loaded in the Accounts hub.</p>
    </section>
  );
}
