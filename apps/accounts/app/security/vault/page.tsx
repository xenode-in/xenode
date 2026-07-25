"use client";

import { useEffect, useRef, useState } from "react";
import {
  derivePasswordWrappingKey,
  encodeBase64Url,
  generateAccountRootKey,
  generateProductSpaceKey,
  generateRecoverySecret,
  recoverySecretText,
  sealEnvelope,
  type Argon2idParams,
} from "@xenode/crypto-core";
import { personalSpaceId } from "@xenode/spaces/ids";
import { deriveArgon2id } from "@/lib/argon2";

type VaultState = {
  accountId: string;
  vault: { vaultRevision: number } | null;
};

function randomParams(): Argon2idParams {
  return {
    algorithm: "argon2id",
    memoryKiB: 64 * 1024,
    iterations: 3,
    parallelism: 1,
    salt: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    outputLength: 32,
  };
}

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
      const accountId = state.accountId;
      const ark = generateAccountRootKey();
      const recovery = generateRecoverySecret();
      const params = randomParams();
      const passwordKey = await derivePasswordWrappingKey(
        pw,
        params,
        deriveArgon2id,
      );
      const sharingPair = (await crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
      )) as CryptoKeyPair;
      const [sharingPublicKey, sharingPrivateKey] = await Promise.all([
        crypto.subtle.exportKey("spki", sharingPair.publicKey),
        crypto.subtle.exportKey("pkcs8", sharingPair.privateKey),
      ]);
      const passwordEnvelope = {
        ...(await sealEnvelope(ark, passwordKey, {
          accountId,
          keyId: "ark",
          keyVersion: 1,
          type: "password",
        })),
        kdfParams: params,
      };
      const recoveryEnvelope = await sealEnvelope(ark, recovery, {
        accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "recovery",
      });
      const wrappedSharingPrivateKey = await sealEnvelope(
        new Uint8Array(sharingPrivateKey),
        ark,
        {
          accountId,
          keyId: "sharing-private-key",
          keyVersion: 1,
          type: "sharing-private-key",
        },
      );

      const personalSpace = personalSpaceId(accountId);
      for (const productId of ["drive", "photos"] as const) {
        const productKey = generateProductSpaceKey();
        const productEnvelope = await sealEnvelope(productKey, ark, {
          accountId,
          spaceId: personalSpace,
          productId,
          keyId: `${personalSpace}:${productId}`,
          keyVersion: 1,
          type: "product-space-key",
        });
        productKey.fill(0);
        const keyResponse = await fetch(
          `/api/space-product-keys?spaceId=${encodeURIComponent(personalSpace)}&productId=${productId}`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(productEnvelope),
          },
        );
        if (!keyResponse.ok) {
          const keyError = (await keyResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            keyError.error ?? `Could not create ${productId} key.`,
          );
        }
      }

      const response = await fetch("/api/vault", {
        method: "PUT",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID().replaceAll("-", ""),
        },
        body: JSON.stringify({
          expectedVaultRevision: 0,
          passwordEnvelope,
          recoveryEnvelope,
          deviceEnvelopes: [],
          sharingPublicKey: encodeBase64Url(new Uint8Array(sharingPublicKey)),
          wrappedSharingPrivateKey,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        vault?: { vaultRevision: number };
      };
      if (!response.ok || !payload.vault) {
        throw new Error(payload.error ?? "Vault creation failed.");
      }
      const recoveryText = recoverySecretText(recovery);
      ark.fill(0);
      recovery.fill(0);
      passwordKey.fill(0);
      setState({ accountId, vault: payload.vault });
      setRecoverySecret(recoveryText);
      setStatus("Vault v2 created. Save the recovery secret now.");
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
          <strong className="callout-title">Recovery secret — shown once</strong>
          <p className="fine-print" style={{ margin: "6px 0 0" }}>
            Store this somewhere safe. It is the only way to recover your Vault
            if you forget your password.
          </p>
          <code className="code-block">{recoverySecret}</code>
          <button
            type="button"
            className="button"
            style={{ marginTop: 16 }}
            onClick={() => window.location.assign(nextPath)}
          >
            I&rsquo;ve saved it — continue
          </button>
        </section>
      ) : null}
    </main>
  );
}
