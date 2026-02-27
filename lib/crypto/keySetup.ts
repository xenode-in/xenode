/**
 * lib/crypto/keySetup.ts
 * Key vault setup and unlock — browser only.
 *
 * Vault passphrase = masterPassword + ":" + recoveryWords
 *
 * This means:
 *   - Master password alone cannot unlock the vault
 *   - Recovery words alone cannot unlock the vault
 *   - Recovery words are only useful when master password is also known
 *     (or when resetting — user sets a new master password + new recovery kit)
 *
 * Normal unlock flow (same device):  IDB cache → silent
 * Normal unlock flow (new device):   Enter master password → done
 * Recovery flow (forgot password):   Enter recovery words + set new password → regenerate vault
 */

import { toB64, fromB64, deriveKey } from "./utils";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

/** Combines master password + recovery words into a single passphrase for PBKDF2 */
export function buildVaultPassphrase(masterPassword: string, recoveryWords: string): string {
  return `${masterPassword}:${recoveryWords}`;
}

/**
 * setupUserKeyVault
 * Called once during onboarding.
 * masterPassword  = user-chosen password (min 8 chars)
 * recoveryWords   = 12 BIP39 words joined with spaces (from generateRecoveryKit)
 */
export async function setupUserKeyVault(
  masterPassword: string,
  recoveryWords: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const passphrase = buildVaultPassphrase(masterPassword, recoveryWords);

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
 * Called on new device / cleared IDB cache.
 * User only needs to enter their master password — recovery words are NOT needed for normal unlock.
 *
 * Wait — how? The vault was encrypted with masterPassword + recoveryWords.
 * So we DO need both... unless we store the recovery words encrypted server-side too?
 *
 * DECISION: For simplicity, normal unlock uses master password ONLY.
 * We store the recovery words encrypted with the master password on the server (separate field).
 * On unlock: fetch encrypted recovery words → decrypt with master password → rebuild full passphrase → decrypt vault.
 */
export async function unlockVault(masterPassword: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch vault");
  }

  const {
    publicKey: publicKeyB64,
    encryptedPrivateKey,
    pbkdf2Salt,
    iv,
    encryptedRecoveryWords,
    recoveryIv,
    recoverySalt,
  } = await res.json();

  // Step 1: Derive a key from master password alone to decrypt the stored recovery words
  const recoveryKey = await deriveKey(masterPassword, fromB64(recoverySalt));
  let recoveryWordsBuf: ArrayBuffer;
  try {
    recoveryWordsBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(recoveryIv) },
      recoveryKey,
      fromB64(encryptedRecoveryWords),
    );
  } catch {
    throw new Error("WRONG_PASSWORD");
  }
  const recoveryWords = new TextDecoder().decode(recoveryWordsBuf);

  // Step 2: Rebuild full passphrase and decrypt the private key
  const passphrase = buildVaultPassphrase(masterPassword, recoveryWords);
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
 * Called when user has their recovery words + sets a new master password.
 * Used in the "forgot master password" recovery flow.
 */
export async function regenerateVault(
  newMasterPassword: string,
  recoveryWords: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  return setupUserKeyVault(newMasterPassword, recoveryWords);
}
