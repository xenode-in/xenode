"use client";

import { useMemo, useState } from "react";
import {
  derivePasswordWrappingKey,
  openEnvelope,
  openRsaOaepProductSpaceKey,
  type Argon2idParams,
  type CryptoEnvelope,
} from "@xenode/crypto-core";
import { FIRST_PARTY_CLIENTS } from "@xenode/identity-core";
import {
  decodeHandoffPublicKey,
  sealProductSpaceKey,
  type HandoffBinding,
} from "@xenode/key-handoff";
import { deriveArgon2id } from "@/lib/argon2";

type VaultEnvelope = CryptoEnvelope & { kdfParams: Argon2idParams };
type VaultResponse = {
  accountId: string;
  vault: {
    passwordEnvelope: VaultEnvelope;
    wrappedSharingPrivateKey: CryptoEnvelope;
  } | null;
};
type ProductKeyResponse = {
  key: {
    spaceId: string;
    productId: string;
    memberAccountId: string;
    keyVersion: number;
    algorithm: "AES-256-GCM" | "RSA-OAEP-256";
    ciphertext: string;
    iv?: string;
    aadVersion: 1;
    status: "active" | "retired" | "revoked";
    createdAt: string;
  };
};

function parseBrokerRequest(): {
  binding: HandoffBinding;
  destinationPublicKey: JsonWebKey;
} {
  const params = new URLSearchParams(window.location.search);
  const names = [
    "transactionId",
    "accountId",
    "clientId",
    "productId",
    "spaceId",
    "destinationOrigin",
    "state",
    "nonce",
  ] as const;
  const binding = Object.fromEntries(
    names.map((name) => [name, params.get(name) ?? ""]),
  ) as unknown as HandoffBinding;
  const client = FIRST_PARTY_CLIENTS.find(
    (candidate) => candidate.clientId === binding.clientId,
  );
  let destinationOrigin = "";
  try {
    destinationOrigin = new URL(binding.destinationOrigin).origin;
  } catch {
    throw new Error("Invalid destination origin.");
  }
  const allowedOrigin =
    client?.redirectUris.some(
      (redirectUri) => new URL(redirectUri).origin === destinationOrigin,
    ) ?? false;
  if (
    !client ||
    client.productId !== binding.productId ||
    !allowedOrigin ||
    destinationOrigin !== binding.destinationOrigin ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(binding.transactionId) ||
    !binding.accountId ||
    !binding.spaceId ||
    binding.state.length < 16 ||
    binding.nonce.length < 16
  ) {
    throw new Error("Invalid or untrusted key handoff request.");
  }
  const publicKeyText = params.get("publicKey");
  if (!publicKeyText) throw new Error("Missing destination public key.");
  return {
    binding,
    destinationPublicKey: decodeHandoffPublicKey(publicKeyText),
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? "Key handoff failed.");
  return payload;
}

export default function KeyHandoffBrokerPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(
    "Confirm the destination and unlock only its product key.",
  );
  const [busy, setBusy] = useState(false);
  const requestLabel = useMemo(() => {
    if (typeof window === "undefined") return "Loading request...";
    try {
      const { binding } = parseBrokerRequest();
      return `${binding.productId} / ${binding.spaceId}`;
    } catch {
      return "Invalid request";
    }
  }, []);

  async function approve() {
    setBusy(true);
    setStatus("Unlocking the requested product key locally...");
    let passwordKey: Uint8Array | undefined;
    let accountRootKey: Uint8Array | undefined;
    let productSpaceKey: Uint8Array | undefined;
    try {
      const { binding, destinationPublicKey } = parseBrokerRequest();
      const [vault, productKeyPayload] = await Promise.all([
        fetch("/api/vault", {
          credentials: "include",
          cache: "no-store",
        }).then((response) => responseJson<VaultResponse>(response)),
        fetch(
          `/api/space-product-keys?spaceId=${encodeURIComponent(binding.spaceId)}&productId=${encodeURIComponent(binding.productId)}`,
          { credentials: "include", cache: "no-store" },
        ).then((response) => responseJson<ProductKeyResponse>(response)),
      ]);
      if (!vault.vault || vault.accountId !== binding.accountId) {
        throw new Error("Sign in to the account that started this handoff.");
      }

      const passwordEnvelope = vault.vault.passwordEnvelope;
      passwordKey = await derivePasswordWrappingKey(
        password,
        passwordEnvelope.kdfParams,
        deriveArgon2id,
      );
      accountRootKey = await openEnvelope(passwordEnvelope, passwordKey, {
        accountId: binding.accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      });

      const stored = productKeyPayload.key;
      if (
        stored.memberAccountId !== binding.accountId ||
        stored.spaceId !== binding.spaceId ||
        stored.productId !== binding.productId
      ) {
        throw new Error("Product key binding mismatch.");
      }
      if (stored.algorithm === "AES-256-GCM") {
        if (!stored.iv) throw new Error("Product key envelope is missing its IV.");
        const productEnvelope: CryptoEnvelope = {
          accountId: stored.memberAccountId,
          spaceId: stored.spaceId,
          productId: stored.productId,
          keyId: `${stored.spaceId}:${stored.productId}`,
          keyVersion: stored.keyVersion,
          formatVersion: 2,
          algorithm: stored.algorithm,
          ciphertext: stored.ciphertext,
          iv: stored.iv,
          aadVersion: stored.aadVersion,
          status: stored.status,
          createdAt: new Date(stored.createdAt).toISOString(),
          type: "product-space-key",
        };
        productSpaceKey = await openEnvelope(productEnvelope, accountRootKey, {
          accountId: binding.accountId,
          spaceId: binding.spaceId,
          productId: binding.productId,
          keyId: `${binding.spaceId}:${binding.productId}`,
          keyVersion: stored.keyVersion,
          type: "product-space-key",
        });
      } else {
        let sharingPrivateKey: Uint8Array | undefined;
        try {
          sharingPrivateKey = await openEnvelope(
            vault.vault.wrappedSharingPrivateKey,
            accountRootKey,
            {
              accountId: binding.accountId,
              keyId: "sharing-private-key",
              keyVersion: 1,
              type: "sharing-private-key",
            },
          );
          productSpaceKey = await openRsaOaepProductSpaceKey(
            stored.ciphertext,
            sharingPrivateKey,
          );
        } finally {
          sharingPrivateKey?.fill(0);
        }
      }
      const sealed = await sealProductSpaceKey(
        productSpaceKey,
        destinationPublicKey,
        binding,
        new Date(Date.now() + 90_000),
      );
      await responseJson<{ transactionId: string }>(
        await fetch("/api/key-handoffs", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...binding,
            ephemeralPublicKeyFingerprint:
              sealed.destinationKeyFingerprint,
            ciphertext: JSON.stringify(sealed),
          }),
        }),
      );

      window.opener?.postMessage(
        {
          type: "xenode:key-handoff-ready",
          transactionId: binding.transactionId,
          state: binding.state,
        },
        binding.destinationOrigin,
      );
      setPassword("");
      setStatus("Key delivered as one-time ciphertext. You may close this window.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Key handoff failed.");
    } finally {
      productSpaceKey?.fill(0);
      accountRootKey?.fill(0);
      passwordKey?.fill(0);
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 64 }}>
      <h1>Unlock product</h1>
      <p style={{ color: "#a1a1aa" }}>
        Accounts will unwrap only the requested ProductSpaceKey. Your Account
        Root Key never leaves this browser.
      </p>
      <p><strong>Request:</strong> {requestLabel}</p>
      <label htmlFor="handoff-password">Vault password</label>
      <input
        id="handoff-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        style={{ display: "block", width: "100%", marginTop: 8, padding: 10 }}
      />
      <button
        type="button"
        disabled={busy || !password}
        onClick={() => void approve()}
        style={{ marginTop: 16, padding: "10px 16px" }}
      >
        {busy ? "Unlocking..." : "Approve one-time handoff"}
      </button>
      <p role="status" style={{ marginTop: 20 }}>{status}</p>
    </main>
  );
}
