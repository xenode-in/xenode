"use client";

import { useEffect, useRef, useState } from "react";
import { generateRecoveryMnemonic } from "@xenode/crypto-core";
import { createAccountVault } from "@/lib/vault-setup";

type VaultState = {
  accountId: string;
  vault: { vaultRevision: number } | null;
};

export default function VaultPage() {
  const [state, setState] = useState<VaultState | null>(null);
  const [password, setPassword] = useState("");
  const [recoverySecret, setRecoverySecret] = useState("");
  const [status, setStatus] = useState("Loading Vault status…");
  const [busy, setBusy] = useState(false);
  // Where to send the user after first-run vault setup (the OIDC handshake they
  // came from, or the hub). Only same-origin paths are honored.
  const [nextPath, setNextPath] = useState("/");
  // True while creating the vault automatically from the signup password —
  // the user is never prompted for a password a second time.
  const [autoSetup, setAutoSetup] = useState(false);
  const autoStarted = useRef(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    if (requested && requested.startsWith("/")) setNextPath(requested);
  }, []);

  useEffect(() => {
    void fetch("/api/vault", { credentials: "include", cache: "no-store" })
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

  // Silent first-run: if the signup step stashed the password, create the vault
  // with it automatically — no second password prompt.
  useEffect(() => {
    if (!state || state.vault || autoStarted.current) return;
    let stashed = "";
    try {
      stashed = sessionStorage.getItem("xenode-vault-pw") ?? "";
    } catch {
      /* storage disabled */
    }
    if (stashed.length >= 12) {
      autoStarted.current = true;
      setAutoSetup(true);
      setStatus("Setting up your encrypted vault…");
      void createVault(stashed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function createVault(pw: string = password) {
    if (!state || state.vault || pw.length < 12) {
      setStatus("Use a password of at least 12 characters.");
      setAutoSetup(false);
      return;
    }
    setBusy(true);
    setStatus("Generating account keys locally…");
    try {
      const { words: recoveryPhrase, secret } = await generateRecoveryMnemonic();
      const vault = await createAccountVault({
        accountId: state.accountId,
        password: pw,
        recoverySecret: secret,
      });
      secret.fill(0);
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
      setAutoSetup(false); // fall back to the manual password form
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
      {!state?.vault && autoSetup && !recoverySecret ? (
        <section className="card" style={{ marginTop: 24 }}>
          <p className="muted" style={{ margin: 0 }}>
            Creating your encrypted vault from your sign-up password…
          </p>
        </section>
      ) : null}
      {!state?.vault && !autoSetup ? (
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
