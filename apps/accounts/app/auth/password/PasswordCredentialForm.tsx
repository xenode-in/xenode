"use client";

import { useState } from "react";
import { sanitizeReturnTo } from "@xenode/identity-core";

/** Optional sign-in credential. This form never reads or changes Vault keys. */
export function PasswordCredentialForm({
  accountLabel,
  next,
}: {
  accountLabel: string;
  next: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12 || password.length > 128 || password !== confirm) {
      setError(
        "Enter matching sign-in passwords between 12 and 128 characters.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error("Could not enable password sign-in.");
      window.location.assign(sanitizeReturnTo(next, "/security"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Password setup failed.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Password sign-in</p>
        <h1>Add a sign-in password</h1>
        <p className="lede">
          Add email sign-in for {accountLabel}. Use a different password from
          your Vault password. This does not change your encryption keys.
        </p>
        <form className="form" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label htmlFor="login-new-password">New sign-in password</label>
            <input
              id="login-new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="login-confirm-password">
              Confirm sign-in password
            </label>
            <input
              id="login-confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button className="button button-block" disabled={busy}>
            {busy ? "Saving…" : "Enable password sign-in"}
          </button>
        </form>
        {error ? (
          <p role="alert" className="status status-error">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
