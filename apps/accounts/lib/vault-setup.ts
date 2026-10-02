import {
  derivePasswordWrappingKey,
  encodeBase64Url,
  generateAccountRootKey,
  generateProductSpaceKey,
  openEnvelope,
  sealEnvelope,
  type Argon2idParams,
} from "@xenode/crypto-core";
import { personalSpaceId } from "@xenode/spaces/ids";
import { deriveArgon2id } from "@/lib/argon2";
import { cacheAccountRootKey } from "@/lib/ark-cache";
import { createBrowserDeviceEnvelope } from "@/lib/device-vault";
import type { VaultBootstrapPayload } from "@/lib/vault-bootstrap-payload";

/** Only ciphertext and a public operation identity; safe to retain in tab memory. */
export interface VaultBootstrapAttempt {
  accountId: string;
  operationId: string;
  payload: VaultBootstrapPayload;
}

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

/**
 * Prepare one sealed Vault and both product keys locally. Callers retain the
 * result across uncertain commits; no raw generated key survives this function.
 */
export async function prepareAccountVault(params: {
  accountId: string;
  password: string;
  recoverySecret: Uint8Array;
  trustDevice?: boolean;
}): Promise<VaultBootstrapAttempt> {
  const { accountId, password, recoverySecret } = params;
  if (password.length < 12 || password.length > 128) {
    throw new Error("Use a password of at least 12 characters.");
  }
  const ark = generateAccountRootKey();
  const kdfParams = randomParams();
  let passwordKey: Uint8Array | undefined;
  let sharingPrivateBytes: Uint8Array | undefined;
  try {
    passwordKey = await derivePasswordWrappingKey(
      password,
      kdfParams,
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

    sharingPrivateBytes = new Uint8Array(sharingPrivateKey);
    const passwordEnvelope = {
      ...(await sealEnvelope(ark, passwordKey, {
        accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      })),
      kdfParams,
    };
    const recoveryEnvelope = await sealEnvelope(ark, recoverySecret, {
      accountId,
      keyId: "ark",
      keyVersion: 1,
      type: "recovery",
    });
    const wrappedSharingPrivateKey = await sealEnvelope(
      sharingPrivateBytes,
      ark,
      {
        accountId,
        keyId: "sharing-private-key",
        keyVersion: 1,
        type: "sharing-private-key",
      },
    );
    const browserDeviceEnvelope = params.trustDevice
      ? await createBrowserDeviceEnvelope(accountId, ark)
      : null;
    const personalSpace = personalSpaceId(accountId);
    const productEnvelopes = {} as VaultBootstrapPayload["productEnvelopes"];
    for (const productId of ["drive", "photos"] as const) {
      const productKey = generateProductSpaceKey();
      try {
        productEnvelopes[productId] = await sealEnvelope(productKey, ark, {
          accountId,
          spaceId: personalSpace,
          productId,
          keyId: `${personalSpace}:${productId}`,
          keyVersion: 1,
          type: "product-space-key",
        });
      } finally {
        productKey.fill(0);
      }
    }
    return {
      accountId,
      operationId: crypto.randomUUID().replaceAll("-", ""),
      payload: {
        passwordEnvelope,
        passwordMode: "separate",
        recoveryEnvelope,
        deviceEnvelopes: browserDeviceEnvelope ? [browserDeviceEnvelope] : [],
        sharingPublicKey: encodeBase64Url(new Uint8Array(sharingPublicKey)),
        wrappedSharingPrivateKey,
        productEnvelopes,
      },
    };
  } finally {
    ark.fill(0);
    passwordKey?.fill(0);
    sharingPrivateBytes?.fill(0);
  }
}

/** Submit the same prepared ciphertext on every retry, then cache its root locally. */
export async function createAccountVault(params: {
  accountId: string;
  attempt: VaultBootstrapAttempt;
  password: string;
  recoverySecret: Uint8Array;
}): Promise<{ vaultRevision: number }> {
  const { accountId, attempt, recoverySecret } = params;
  if (attempt.accountId !== accountId) throw new Error("Vault attempt belongs to another account.");
  // Also ensure a changed recovery kit cannot be displayed for the old attempt.
  const ark = await openEnvelope(attempt.payload.recoveryEnvelope, recoverySecret, {
    accountId, keyId: "ark", keyVersion: 1, type: "recovery",
  });
  let passwordKey: Uint8Array | undefined;
  let passwordArk: Uint8Array | undefined;
  try {
    passwordKey = await derivePasswordWrappingKey(params.password, attempt.payload.passwordEnvelope.kdfParams, deriveArgon2id);
    passwordArk = await openEnvelope(attempt.payload.passwordEnvelope, passwordKey, {
      accountId, keyId: "ark", keyVersion: 1, type: "password",
    });
    if (passwordArk.length !== ark.length || passwordArk.some((byte, index) => byte !== ark[index])) {
      throw new Error("Use the Vault password and recovery kit from this setup attempt.");
    }
    const response = await fetch("/api/vault/bootstrap", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", "idempotency-key": attempt.operationId },
      body: JSON.stringify(attempt.payload),
    });
    const payload = (await response.json()) as { error?: string; vault?: { vaultRevision: number } };
    if (!response.ok || !payload.vault || payload.vault.vaultRevision !== 1) {
      throw new Error(payload.error ?? "Vault creation could not be confirmed. Retry with the same recovery kit.");
    }
    await cacheAccountRootKey(accountId, ark).catch(() => undefined);
    return payload.vault;
  } finally {
    ark.fill(0);
    passwordKey?.fill(0);
    passwordArk?.fill(0);
  }
}
