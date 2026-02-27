/**
 * lib/crypto/keySetup.ts
 * Key vault setup and unlock — browser only.
 *
 * The vault passphrase is always the recovery kit words joined with spaces.
 * Users never type this — they enter it once on a new device by reading
 * their saved recovery kit.
 */

import { toB64, fromB64, deriveKey } from "./utils";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

/**
 * setupUserKeyVault
 * Called once during onboarding after the user saves their recovery kit.
 * passphrase = recoveryKit.words.join(" ")
 */
export async function setupUserKeyVault(passphrase: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const keypair = await crypto.subtle.generateKey(RSA_PARAMS, true, ["encrypt", "decrypt"]);
  const publicKeyBuf = await crypto.subtle.exportKey("spki", keypair.publicKey);
  const privateKeyBuf = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);

  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const masterKey = await deriveKey(passphrase, salt);

  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    privateKeyBuf,
  );

  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: toB64(publicKeyBuf),
      encryptedPrivateKey: toB64(encryptedPrivKey),
      pbkdf2Salt: toB64(salt),
      iv: toB64(iv),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save vault");
  }

  const privateKey = await crypto.subtle.importKey("pkcs8", privateKeyBuf, RSA_PARAMS, false, ["decrypt"]);
  return { privateKey, publicKey: keypair.publicKey };
}

/**
 * unlockVault
 * Called on every new device/session when IDB cache is empty.
 * passphrase = the 12 recovery words joined with spaces.
 */
export async function unlockVault(passphrase: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch vault");
  }

  const { publicKey: publicKeyB64, encryptedPrivateKey, pbkdf2Salt, iv } = await res.json();

  const masterKey = await deriveKey(passphrase, fromB64(pbkdf2Salt));

  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      masterKey,
      fromB64(encryptedPrivateKey),
    );
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  const privateKey = await crypto.subtle.importKey("pkcs8", privateKeyBuf, RSA_PARAMS, false, ["decrypt"]);
  const publicKey = await crypto.subtle.importKey("spki", fromB64(publicKeyB64), RSA_PARAMS, false, ["encrypt"]);
  return { privateKey, publicKey };
}

/**
 * regenerateVault
 * Called from Settings when user wants a new recovery kit.
 * Generates a new keypair with the new passphrase and replaces the vault.
 * WARNING: old encrypted files become inaccessible.
 */
export async function regenerateVault(newPassphrase: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  // Same as setup — just overwrites via upsert on the server
  return setupUserKeyVault(newPassphrase);
}
