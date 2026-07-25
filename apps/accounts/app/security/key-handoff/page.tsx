"use client";

import { useEffect, useMemo, useState } from "react";
import {
  derivePasswordWrappingKey,
  decodeBase64Url,
  importProductKey,
  openEnvelope,
  openEnvelopeWithKey,
  openRsaOaepProductSpaceKey,
  type Argon2idParams,
  type CryptoEnvelope,
} from "@xenode/crypto-core";
import {
  cacheAccountRootKey,
  loadCachedAccountRootKey,
} from "@/lib/ark-cache";
import { FIRST_PARTY_CLIENTS } from "@xenode/identity-core";
import {
  decodeHandoffPublicKey,
  sealProductSpaceKey,
  sealProductKeyBundle,
  type HandoffBinding,
} from "@xenode/key-handoff";
import { deriveArgon2id } from "@/lib/argon2";

type VaultEnvelope = CryptoEnvelope & { kdfParams: Argon2idParams };
type VaultResponse = {
  accountId: string;
  vault: {
    passwordEnvelope: VaultEnvelope;
    sharingPublicKey: string;
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
  mode: "popup" | "redirect";
  returnPath: string;
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
  if (
    !client ||
    client.productId !== binding.productId ||
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
  // Redirect transport: a same-origin return path. Reject anything that could
  // resolve off the destination origin (protocol-relative, absolute URLs).
  const mode = params.get("mode") === "redirect" ? "redirect" : "popup";
  const requestedReturn = params.get("returnPath") ?? "/";
  const returnPath = /^\/(?!\/)/u.test(requestedReturn) ? requestedReturn : "/";
  return {
    binding,
    destinationPublicKey: decodeHandoffPublicKey(publicKeyText),
    mode,
    returnPath,
  };
}

/** Build the same-origin URL to return to after a redirect handoff (or null if unsafe). */
function buildReturnUrl(binding: HandoffBinding, returnPath: string): string | null {
  try {
    const target = new URL(returnPath || "/", binding.destinationOrigin);
    if (target.origin !== binding.destinationOrigin) return null;
    target.hash = `xenode-handoff=${encodeURIComponent(
      binding.transactionId,
    )}&xenode-state=${encodeURIComponent(binding.state)}`;
    return target.toString();
  } catch {
    return null;
  }
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
  // Gate window.location-derived content until after mount so the server render
  // and the first client (hydration) render match. Only then compute the label.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const requestLabel = useMemo(() => {
    if (!mounted) return "Loading request...";
    try {
      const { binding } = parseBrokerRequest();
      return `${binding.productId} / ${binding.spaceId}`;
    } catch {
      return "Invalid request";
    }
  }, [mounted]);

  // If the ARK is cached on this device, seal the product key automatically —
  // no password prompt (seamless unlock). Otherwise fall back to the form.
  const [hasCachedArk, setHasCachedArk] = useState(false);
  const [autoTried, setAutoTried] = useState(false);
  useEffect(() => {
    if (!mounted || autoTried) return;
    setAutoTried(true);
    void (async () => {
      try {
        const { binding } = parseBrokerRequest();
        const cached = await loadCachedAccountRootKey(binding.accountId);
        if (cached) {
          setHasCachedArk(true);
          void approve(true);
        }
      } catch {
        /* invalid request — the form/label already reflects it */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, autoTried]);

  async function approve(useCachedArk: boolean) {
    setBusy(true);
    setStatus("Unlocking the requested product key locally...");
    let passwordKey: Uint8Array | undefined;
    let accountRootKey: Uint8Array | undefined;
    let productSpaceKey: Uint8Array | undefined;
    let sharingPrivateKey: Uint8Array | undefined;
    try {
      const { binding, destinationPublicKey, mode, returnPath } =
        parseBrokerRequest();
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

      // Obtain the ARK as a non-extractable CryptoKey: from the device cache
      // (no password needed) or by deriving it from the vault password once.
      let arkKey: CryptoKey | null = useCachedArk
        ? await loadCachedAccountRootKey(binding.accountId)
        : null;
      if (!arkKey) {
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
        arkKey = await importProductKey(accountRootKey);
        await cacheAccountRootKey(binding.accountId, accountRootKey).catch(
          () => undefined,
        );
      }

      const stored = productKeyPayload.key;
      if (
        stored.memberAccountId !== binding.accountId ||
        stored.spaceId !== binding.spaceId ||
        stored.productId !== binding.productId
      ) {
        throw new Error("Product key binding mismatch.");
      }
      if (binding.productId === "drive" || stored.algorithm === "RSA-OAEP-256") {
        sharingPrivateKey = await openEnvelopeWithKey(
          vault.vault.wrappedSharingPrivateKey,
          arkKey,
          {
            accountId: binding.accountId,
            keyId: "sharing-private-key",
            keyVersion: 1,
            type: "sharing-private-key",
          },
        );
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
        productSpaceKey = await openEnvelopeWithKey(productEnvelope, arkKey, {
          accountId: binding.accountId,
          spaceId: binding.spaceId,
          productId: binding.productId,
          keyId: `${binding.spaceId}:${binding.productId}`,
          keyVersion: stored.keyVersion,
          type: "product-space-key",
        });
      } else {
        if (!sharingPrivateKey) throw new Error("Sharing private key is unavailable.");
        productSpaceKey = await openRsaOaepProductSpaceKey(
          stored.ciphertext,
          sharingPrivateKey,
        );
      }
      const sealed = binding.productId === "drive"
        ? await sealProductKeyBundle(
            {
              productSpaceKey,
              sharingPrivateKeyPkcs8: sharingPrivateKey,
              sharingPublicKeySpki: decodeBase64Url(vault.vault.sharingPublicKey),
            },
            destinationPublicKey,
            binding,
            new Date(Date.now() + 90_000),
          )
        : await sealProductSpaceKey(
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

      setPassword("");
      if (mode === "redirect") {
        const returnUrl = buildReturnUrl(binding, returnPath);
        if (!returnUrl) throw new Error("Invalid return path.");
        setStatus("Key delivered. Returning you to the app…");
        window.location.assign(returnUrl);
        return;
      }
      window.opener?.postMessage(
        {
          type: "xenode:key-handoff-ready",
          transactionId: binding.transactionId,
          state: binding.state,
        },
        binding.destinationOrigin,
      );
      setStatus("Key delivered as one-time ciphertext. You may close this window.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Key handoff failed.");
    } finally {
      productSpaceKey?.fill(0);
      sharingPrivateKey?.fill(0);
      accountRootKey?.fill(0);
      passwordKey?.fill(0);
      setBusy(false);
    }
  }

  return (
    <main className="page page-narrow">
      <p className="eyebrow">Key handoff</p>
      <h1>Unlock this product</h1>
      <p className="lede">
        Accounts unwraps the requested ProductSpaceKey and, for Drive, its
        subordinate sharing key. Your Account Root Key never leaves this browser.
      </p>
      <section className="card" style={{ marginTop: 24 }}>
        <div className="badge" style={{ marginBottom: 16 }}>{requestLabel}</div>
        {hasCachedArk ? (
          <p className="muted" style={{ margin: 0 }}>
            Unlocking automatically — this device already holds your unlocked
            vault. No password needed.
          </p>
        ) : (
          <form
            className="form"
            style={{ maxWidth: 460 }}
            onSubmit={(event) => {
              event.preventDefault();
              void approve(false);
            }}
          >
            <div className="field">
              <label htmlFor="handoff-password">Vault password</label>
              <input
                className="input"
                id="handoff-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button className="button" type="submit" disabled={busy || !password}>
              {busy ? "Unlocking…" : "Approve one-time handoff"}
            </button>
          </form>
        )}
      </section>
      {status ? (
        <p className="status" role="status" style={{ marginTop: 20 }}>
          {status}
        </p>
      ) : null}
    </main>
  );
}
