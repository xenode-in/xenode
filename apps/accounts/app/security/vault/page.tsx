"use client";

import { useEffect, useState } from "react";
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
import { personalSpaceId } from "@xenode/spaces";
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

  async function createVault() {
    if (!state || state.vault || password.length < 12) {
      setStatus("Use a password of at least 12 characters.");
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
        password,
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Vault creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 64 }}>
      <a href="/security" style={{ color: "#a1a1aa" }}>← Security</a>
      <h1>Encrypted Vault</h1>
      <p style={{ color: "#a1a1aa" }}>
        Account Root Keys and sharing private keys are generated and wrapped in
        this browser. Accounts stores ciphertext envelopes only.
      </p>
      <p role="status">{status}</p>
      {!state?.vault ? (
        <div style={{ display: "grid", gap: 12, maxWidth: 480 }}>
          <label htmlFor="vault-password">Vault password</label>
          <input
            id="vault-password"
            type="password"
            value={password}
            minLength={12}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => void createVault()}>
            {busy ? "Creating…" : "Create Vault v2"}
          </button>
        </div>
      ) : null}
      {recoverySecret ? (
        <section style={{ marginTop: 24, border: "1px solid #7c2d12", padding: 16 }}>
          <strong>Recovery secret — shown once</strong>
          <code style={{ display: "block", overflowWrap: "anywhere", marginTop: 12 }}>
            {recoverySecret}
          </code>
        </section>
      ) : null}
    </main>
  );
}
