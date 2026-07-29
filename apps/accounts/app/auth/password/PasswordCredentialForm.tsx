"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  addPasswordToVault,
  cacheArkFromLogin,
  confirmVaultUnlock,
} from "@/lib/password-vault";

export function PasswordCredentialForm({
  accountLabel,
  needsRecovery,
  next,
}: {
  accountLabel: string;
  needsRecovery: boolean;
  next: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12) {
      setError("Enter your Vault password of at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (needsRecovery) {
        await addPasswordToVault(password, recoveryPhrase);
      } else {
        // Fail closed unless this exact password opens the existing local
        // password envelope. This keeps login and Vault passwords coordinated.
        await cacheArkFromLogin(password);
      }
      const response = await fetch("/api/account/password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not enable password sign-in.");
      }
      await confirmVaultUnlock("password", password);
      window.location.assign(next);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Password setup failed.");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Password sign-in</p>
        <h1>Enable your Xenode password</h1>
        <p className="lede">
          {needsRecovery
            ? `Create a password for ${accountLabel}. Your recovery phrase confirms that the password is wrapping the existing Vault, without rotating your files or keys.`
            : `Enter the Vault password you created for ${accountLabel}. Xenode will add it as an email/username sign-in method while keeping the existing account, Vault, Spaces, and OAuth connection.`}
        </p>
        <form className="form" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label htmlFor="oauth-vault-password">Vault password</label>
            <input
              id="oauth-vault-password"
              className="input"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {needsRecovery ? (
            <div className="field">
              <label htmlFor="oauth-vault-recovery">
                12-word recovery phrase
              </label>
              <textarea
                id="oauth-vault-recovery"
                className="input"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                value={recoveryPhrase}
                onChange={(event) => setRecoveryPhrase(event.target.value)}
                placeholder="word 1  word 2  word 3 …"
              />
              <p className="hint">
                The phrase is used only in this browser to open your existing
                Vault. It is never sent to Xenode.
              </p>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="oauth-vault-confirm">Confirm password</label>
            <input
              id="oauth-vault-confirm"
              className="input"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          <button className="button button-block" type="submit" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="onb-spin" /> Enabling password…
              </>
            ) : (
              "Enable password sign-in"
            )}
          </button>
        </form>
        {error ? (
          <p className="status status-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
