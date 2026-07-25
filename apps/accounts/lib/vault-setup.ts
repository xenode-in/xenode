import {
  derivePasswordWrappingKey,
  encodeBase64Url,
  generateAccountRootKey,
  generateProductSpaceKey,
  sealEnvelope,
  type Argon2idParams,
} from "@xenode/crypto-core";
import { personalSpaceId } from "@xenode/spaces/ids";
import { deriveArgon2id } from "@/lib/argon2";
import { cacheAccountRootKey } from "@/lib/ark-cache";

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
 * Create the account's Vault v2 in this browser and cache the ARK for seamless
 * unlock. Generates the Account Root Key + RSA sharing keypair, seals the
 * password / recovery / sharing-private-key envelopes, PUTs a ProductSpaceKey
 * for Drive + Photos, then PUTs the vault. All raw key material is zeroed before
 * returning. `recoverySecret` is the 256-bit key derived from the user's 12-word
 * BIP39 phrase (see crypto-core `generateRecoveryMnemonic`).
 *
 * Shared by the security/vault page and the onboarding wizard so there is one
 * canonical vault-creation path.
 */
export async function createAccountVault(params: {
  accountId: string;
  password: string;
  recoverySecret: Uint8Array;
}): Promise<{ vaultRevision: number }> {
  const { accountId, password, recoverySecret } = params;
  if (password.length < 12) {
    throw new Error("Use a password of at least 12 characters.");
  }
  const ark = generateAccountRootKey();
  const kdfParams = randomParams();
  const passwordKey = await derivePasswordWrappingKey(
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
      throw new Error(keyError.error ?? `Could not create ${productId} key.`);
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

  // Cache the ARK so the key-handoff broker unlocks Drive/Photos with no prompt.
  await cacheAccountRootKey(accountId, ark).catch(() => undefined);
  ark.fill(0);
  passwordKey.fill(0);
  return payload.vault;
}
