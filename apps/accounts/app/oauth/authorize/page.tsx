"use client";

import { useMemo, useState } from "react";

const CLIENT_NAMES: Record<string, string> = {
  "xenode-drive-web": "Xenode Drive",
  "xenode-photos-web": "Xenode Photos",
  "xenode-mobile": "Xenode Mobile",
  "xenode-office-editor": "Xenode Office Editor",
};

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm your Xenode account identity",
  profile: "Read your display name and username",
  email: "Read your verified email address",
  offline_access: "Keep this product signed in until you revoke it",
};

export default function ConsentPage() {
  const query = useMemo(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search), []);
  const consentCode = query.get("consent_code") ?? "";
  const clientId = query.get("client_id") ?? "unknown-client";
  const scopes = (query.get("scope") ?? "openid").split(" ").filter(Boolean);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function decide(accept: boolean) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, consent_code: consentCode || undefined }),
    });
    const payload = (await response.json().catch(() => null)) as { redirectURI?: string } | null;
    if (!response.ok || !payload?.redirectURI) {
      setBusy(false);
      setMessage("This authorization request is invalid or has expired.");
      return;
    }
    window.location.assign(payload.redirectURI);
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <p className="eyebrow">Product authorization</p>
        <h1>Continue to {CLIENT_NAMES[clientId] ?? clientId}</h1>
        <p className="lede" style={{ marginBottom: 24 }}>This product is requesting identity claims only. Your Account Root Key and product-space keys are never placed in OIDC tokens.</p>
        <div className="card" style={{ padding: 16 }}>
          <strong>Requested access</strong>
          <ul className="fine-print">{scopes.map((scope) => <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>)}</ul>
        </div>
        {message ? <p className="status status-error" role="alert" style={{ marginTop: 16 }}>{message}</p> : null}
        <div className="button-row" style={{ marginTop: 20 }}>
          <button className="button" disabled={busy} onClick={() => void decide(true)}>Allow</button>
          <button className="button button-secondary" disabled={busy} onClick={() => void decide(false)}>Cancel</button>
        </div>
      </section>
    </main>
  );
}
