"use client";

import { VAULT_CLIENT_HEADERS } from "@/lib/vault-protocol";


import { useEffect, useRef, useState } from "react";
import { generateRecoveryMnemonic } from "@xenode/crypto-core";
import { VaultPasswordForm } from "@/components/VaultPasswordForm";
import { createAccountVault, prepareAccountVault, type VaultBootstrapAttempt } from "@/lib/vault-setup";

type VaultState = {
  accountId: string;
  vault: { vaultRevision: number; passwordMode?: "separate" } | null;
};

export default function VaultPage() {
  const [state, setState] = useState<VaultState | null>(null);
  const [password, setPassword] = useState("");
  const [recoverySecret, setRecoverySecret] = useState("");
  const [status, setStatus] = useState("Loading Vault status…");
  const [busy, setBusy] = useState(false);
  const creation = useRef<{ kit: Awaited<ReturnType<typeof generateRecoveryMnemonic>>; attempt?: VaultBootstrapAttempt } | null>(null);
  // Where to send the user after first-run vault setup (the OIDC handshake they
  // came from, or the hub). Only same-origin paths are honored.
  const [nextPath, setNextPath] = useState("/");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    if (requested && requested.startsWith("/")) {
      queueMicrotask(() => setNextPath(requested));
    }
  }, []);

  useEffect(() => {
    void fetch("/api/vault", {
          headers: VAULT_CLIENT_HEADERS, credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign in to manage your Vault.");
        return response.json() as Promise<VaultState>;
      })
      .then((value) => {
        setState(value);
        setStatus(value.vault ? "Vault v2 is active." : "Create your Vault v2.");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Could not load Vault.");
      });
  }, []);

  async function createVault(pw: string = password) {
    if (!state || state.vault || pw.length < 12) {
      setStatus("Use a password of at least 12 characters.");
      return;
    }
    setBusy(true);
    setStatus("Generating account keys locally…");
    try {
      creation.current ??= { kit: await generateRecoveryMnemonic() };
      const pending = creation.current;
      const { words: recoveryPhrase, secret } = pending.kit;
      pending.attempt ??= await prepareAccountVault({ accountId: state.accountId, password: pw, recoverySecret: secret });
      const vault = await createAccountVault({
        accountId: state.accountId,
        attempt: pending.attempt,
        password: pw,
        recoverySecret: secret,
      });
      secret.fill(0);
      creation.current = null;
      setState({ accountId: state.accountId, vault });
      setRecoverySecret(recoveryPhrase);
      setStatus("Vault v2 created. Save your 12-word recovery phrase now.");
      setPassword("");
      try {
        sessionStorage.removeItem("xenode-vault-pw");
      } catch {
        /* storage disabled */
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Vault creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page-narrow">
      <a href="/security" className="back-link">← Security</a>
      <p className="eyebrow" style={{ marginTop: 20 }}>Encrypted Vault</p>
      <h1>Your keys, sealed in this browser</h1>
      <p className="lede">
        Account Root Keys and sharing private keys are generated and wrapped in
        this browser. Accounts stores ciphertext envelopes only — never your
        plaintext keys.
      </p>
      {status ? (
        <p className="status" role="status" style={{ marginTop: 24 }}>
          {status}
        </p>
      ) : null}
      {!state?.vault ? (
        <section className="card" style={{ marginTop: 24 }}>
          <form
            className="form"
            style={{ maxWidth: 460 }}
            onSubmit={(event) => {
              event.preventDefault();
              void createVault();
            }}
          >
            <div className="field">
              <label htmlFor="vault-password">Vault password</label>
              <input
                className="input"
                id="vault-password"
                type="password"
                value={password}
                minLength={12}
                autoComplete="new-password"
                placeholder="At least 12 characters"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create Vault v2"}
            </button>
          </form>
        </section>
      ) : null}
      {state?.vault && !recoverySecret ? <VaultPasswordForm migrating={state.vault.passwordMode !== "separate"} onComplete={() => window.location.assign(nextPath)} /> : null}
      {recoverySecret ? (
        <section className="callout callout-warning" style={{ marginTop: 24 }}>
          <strong className="callout-title">
            Recovery phrase — shown once
          </strong>
          <p className="fine-print" style={{ margin: "6px 0 0" }}>
            Write down these 12 words in order and store them somewhere safe.
            They are the only way to recover your Vault if you forget your
            password.
          </p>
          <ol
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 8,
              listStyle: "none",
              padding: 0,
              margin: "16px 0 0",
            }}
          >
            {recoverySecret.split(" ").map((word, index) => (
              <li
                key={`${index}-${word}`}
                className="code-block"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                }}
              >
                <span
                  className="fine-print"
                  style={{ opacity: 0.6, minWidth: 18, textAlign: "right" }}
                >
                  {index + 1}
                </span>
                <span style={{ fontWeight: 600 }}>{word}</span>
              </li>
            ))}
          </ol>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(recoverySecret)
                  .catch(() => undefined);
              }}
            >
              Copy phrase
            </button>
            <button
              type="button"
              className="button"
              onClick={() => window.location.assign(nextPath)}
            >
              I&rsquo;ve saved it — continue
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
