/**
 * lib/crypto/keySetup.ts
 * Dual-layer vault: passphrase (always) + PRF passkey (optional).
 *
 * Vault types:
 *   'passphrase' — only passphrase unlock available
 *   'both'       — passphrase AND passkey PRF both work (ideal)
 *   'prf'        — legacy: PRF only (old vaults before dual-layer)
 *
 * On unlock, try PRF silently first (if 'both'), fall back to passphrase.
 */

import { toB64, fromB64, deriveKey } from "./utils";
import { registerWithPRF, authenticateWithPRF, deriveKeyFromPRF } from "./prf";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function generateKeypair(): Promise<{
  keypair: CryptoKeyPair;
  privateKeyBuf: ArrayBuffer;
  publicKeyBuf: ArrayBuffer;
}> {
  const keypair = await crypto.subtle.generateKey(RSA_PARAMS, true, [
    "encrypt",
    "decrypt",
  ]);
  const privateKeyBuf = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const publicKeyBuf = await crypto.subtle.exportKey("spki", keypair.publicKey);
  return { keypair, privateKeyBuf, publicKeyBuf };
}

async function encryptPrivKey(
  privateKeyBuf: ArrayBuffer,
  masterKey: CryptoKey,
): Promise<{ encryptedB64: string; ivB64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    privateKeyBuf,
  );
  return { encryptedB64: toB64(encrypted), ivB64: toB64(iv) };
}

async function decryptPrivKey(
  encryptedB64: string,
  ivB64: string,
  masterKey: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    masterKey,
    fromB64(encryptedB64),
  );
}

async function importPrivateKey(buf: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", buf, RSA_PARAMS, false, ["decrypt"]);
}

async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", fromB64(b64), RSA_PARAMS, false, ["encrypt"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY: Setup vault with passphrase (always required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new vault secured with passphrase.
 * Called from onboarding Step 4 (always).
 * Returns keys for immediate use + caching.
 */
export async function setupUserKeyVault(passphrase: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const masterKey = await deriveKey(passphrase, salt);

  const { privateKeyBuf, publicKeyBuf } = await generateKeypair();
  const { encryptedB64, ivB64 } = await encryptPrivKey(privateKeyBuf, masterKey);

  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: toB64(publicKeyBuf),
      encryptedPrivKeyPassphrase: encryptedB64,
      passphraseIv: ivB64,
      pbkdf2Salt: toB64(salt),
      vaultType: "passphrase",
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save vault");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(toB64(publicKeyBuf));
  return { privateKey, publicKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL: Add PRF layer on top of existing passphrase vault
// Called from onboarding (optional) or Settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a PRF passkey layer to an existing passphrase vault.
 * 1. Unlock vault with passphrase to get raw private key
 * 2. Register new passkey with PRF
 * 3. Re-encrypt same private key with PRF master key
 * 4. PATCH vault with new PRF fields → vaultType becomes 'both'
 *
 * @param passphrase - current vault passphrase (to decrypt private key)
 * @param userId     - Better Auth user ID
 * @param userName   - user email/name for passkey display
 */
export async function addPRFLayerToVault(
  passphrase: string,
  userId: string,
  userName: string,
): Promise<{ supported: boolean }> {
  // 1. Fetch vault
  const res = await fetch("/api/keys/vault");
  if (!res.ok) throw new Error("Failed to fetch vault");
  const vault = await res.json();

  // 2. Decrypt private key with passphrase
  const passphraseMasterKey = await deriveKey(passphrase, fromB64(vault.pbkdf2Salt));
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await decryptPrivKey(
      vault.encryptedPrivKeyPassphrase,
      vault.passphraseIv,
      passphraseMasterKey,
    );
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  // 3. Register passkey with PRF
  const prfSalt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
  const userIdBytes = new TextEncoder().encode(userId);
  const { credentialId, prfOutput, supported } = await registerWithPRF(
    prfSalt,
    userIdBytes,
    userName,
  );

  if (!supported) return { supported: false };

  // 4. Derive PRF master key + re-encrypt same private key
  const prfMasterKey = await deriveKeyFromPRF(prfOutput);
  const { encryptedB64: encryptedPrivKeyPRF, ivB64: prfIv } = await encryptPrivKey(
    privateKeyBuf,
    prfMasterKey,
  );

  // 5. PATCH vault — add PRF layer
  const patchRes = await fetch("/api/keys/vault/prf", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encryptedPrivKeyPRF,
      prfIv,
      prfSalt: toB64(prfSalt),
      credentialId,
    }),
  });

  if (!patchRes.ok) {
    const data = await patchRes.json().catch(() => ({}));
    throw new Error(data.error || "Failed to add PRF layer");
  }

  return { supported: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNLOCK: Passphrase path
// ─────────────────────────────────────────────────────────────────────────────

export async function unlockVault(passphrase: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) throw new Error("Failed to fetch vault");

  const vault = await res.json();

  const masterKey = await deriveKey(passphrase, fromB64(vault.pbkdf2Salt));

  // Support both new field name and legacy field name
  const encryptedPrivKey = vault.encryptedPrivKeyPassphrase ?? vault.encryptedPrivateKey;
  const iv = vault.passphraseIv ?? vault.iv;

  if (!encryptedPrivKey || !iv) throw new Error("Vault data incomplete");

  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await decryptPrivKey(encryptedPrivKey, iv, masterKey);
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(vault.publicKey);
  return { privateKey, publicKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNLOCK: PRF path
// ─────────────────────────────────────────────────────────────────────────────

export async function unlockVaultWithPRF(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) throw new Error("Failed to fetch vault");

  const vault = await res.json();

  if (!vault.prfSalt || !vault.encryptedPrivKeyPRF || !vault.prfIv) {
    throw new Error("NOT_PRF_VAULT");
  }

  const { prfOutput, supported } = await authenticateWithPRF(fromB64(vault.prfSalt));
  if (!supported) throw new Error("PRF_NOT_SUPPORTED");

  const masterKey = await deriveKeyFromPRF(prfOutput);

  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await decryptPrivKey(
      vault.encryptedPrivKeyPRF,
      vault.prfIv,
      masterKey,
    );
  } catch {
    throw new Error("PRF_DECRYPT_FAILED");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(vault.publicKey);
  return { privateKey, publicKey };
}

// Legacy export kept for any code that still imports setupVaultWithPRF
export { addPRFLayerToVault as setupVaultWithPRF };
