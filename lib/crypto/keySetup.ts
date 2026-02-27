/**
 * lib/crypto/keySetup.ts
 *
 * Vault setup/unlock for Xenode E2EE.
 *
 * Vault types:
 *   'passphrase' — created with passphrase in onboarding fallback path
 *   'prf'        — created with passkey PRF in onboarding primary path
 *   'both'       — passphrase vault upgraded with PRF in Settings
 *
 * Onboarding:
 *   Primary path  → setupVaultWithPRF(userId, userName)
 *                    → generates keypair + registers passkey + saves vault (vaultType: 'prf')
 *   Fallback path → setupUserKeyVault(passphrase)
 *                    → generates keypair + encrypts with PBKDF2 + saves vault (vaultType: 'passphrase')
 *
 * Settings:
 *   Add passkey   → addPRFLayerToVault(passphrase, userId, userName)
 *                    → unlocks existing passphrase vault + adds PRF encryption (vaultType: 'both')
 *
 * Unlock:
 *   'prf'         → unlockVaultWithPRF()   (passkey biometric)
 *   'passphrase'  → unlockVault(passphrase)
 *   'both'        → try unlockVaultWithPRF() silently, fallback to unlockVault(passphrase)
 */

import { toB64, fromB64, deriveKey } from "./utils";
import { registerWithPRF, authenticateWithPRF, deriveKeyFromPRF } from "./prf";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

// ──────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────

async function generateKeypair() {
  const keypair = await crypto.subtle.generateKey(RSA_PARAMS, true, ["encrypt", "decrypt"]);
  const privateKeyBuf = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const publicKeyBuf = await crypto.subtle.exportKey("spki", keypair.publicKey);
  return { keypair, privateKeyBuf, publicKeyBuf };
}

async function encryptPrivKey(privateKeyBuf: ArrayBuffer, masterKey: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, masterKey, privateKeyBuf);
  return { encryptedB64: toB64(encrypted), ivB64: toB64(iv) };
}

async function decryptPrivKey(encryptedB64: string, ivB64: string, masterKey: CryptoKey) {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    masterKey,
    fromB64(encryptedB64),
  );
}

async function importPrivateKey(buf: ArrayBuffer) {
  return crypto.subtle.importKey("pkcs8", buf, RSA_PARAMS, false, ["decrypt"]);
}

async function importPublicKey(b64: string) {
  return crypto.subtle.importKey("spki", fromB64(b64), RSA_PARAMS, false, ["encrypt"]);
}

// ──────────────────────────────────────
// ONBOARDING PRIMARY: PRF passkey vault (new user, no existing vault)
// ──────────────────────────────────────

/**
 * PRIMARY onboarding path: register passkey with PRF, generate keypair,
 * encrypt private key with PRF master key, save vault (vaultType: 'prf').
 *
 * Does NOT require an existing vault. Creates one from scratch.
 */
export async function setupVaultWithPRF(
  userId: string,
  userName: string,
): Promise<{
  supported: boolean;
  privateKey?: CryptoKey;
  publicKey?: CryptoKey;
}> {
  // 1. Generate RSA keypair
  const { privateKeyBuf, publicKeyBuf } = await generateKeypair();

  // 2. Generate PRF salt (stored on server, used for future auth)
  const prfSalt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
  const userIdBytes = new TextEncoder().encode(userId);

  // 3. Register passkey with PRF extension
  const { credentialId, prfOutput, supported } = await registerWithPRF(
    prfSalt,
    userIdBytes,
    userName,
  );

  if (!supported) {
    // PRF not supported on this browser/device — caller should show passphrase fallback
    return { supported: false };
  }

  // 4. Derive AES master key from PRF output
  const masterKey = await deriveKeyFromPRF(prfOutput);

  // 5. Encrypt private key with PRF master key
  const { encryptedB64, ivB64 } = await encryptPrivKey(privateKeyBuf, masterKey);

  // 6. Save vault — PRF-only (vaultType: 'prf')
  // Also store a dummy pbkdf2Salt so schema validation passes
  const dummySalt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: toB64(publicKeyBuf),
      pbkdf2Salt: toB64(dummySalt),        // required by schema, not used for prf-only
      encryptedPrivKeyPRF: encryptedB64,
      prfIv: ivB64,
      prfSalt: toB64(prfSalt),
      credentialId,
      vaultType: "prf",
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save vault");
  }

  // 7. Import keys for immediate use
  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(toB64(publicKeyBuf));
  return { supported: true, privateKey, publicKey };
}

// ──────────────────────────────────────
// ONBOARDING FALLBACK: Passphrase vault (new user, no existing vault)
// ──────────────────────────────────────

/**
 * FALLBACK onboarding path: create vault encrypted with PBKDF2 passphrase.
 * Used when PRF not supported, or user clicks 'Use passphrase instead'.
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

// ──────────────────────────────────────
// SETTINGS: Add PRF layer to existing passphrase vault
// ──────────────────────────────────────

/**
 * Called from Settings → Security when a passphrase-vault user adds a passkey.
 * Requires an existing passphrase vault.
 * 1. Fetches vault
 * 2. Unlocks with passphrase to get raw private key
 * 3. Registers passkey with PRF
 * 4. Re-encrypts same private key with PRF master key
 * 5. PATCHes vault → vaultType becomes 'both'
 */
export async function addPRFLayerToVault(
  passphrase: string,
  userId: string,
  userName: string,
): Promise<{ supported: boolean }> {
  // 1. Fetch existing vault
  const res = await fetch("/api/keys/vault");
  if (!res.ok) throw new Error("No vault found. Set up encryption first.");
  const vault = await res.json();

  // 2. Unlock with passphrase
  const passphraseMasterKey = await deriveKey(passphrase, fromB64(vault.pbkdf2Salt));
  let privateKeyBuf: ArrayBuffer;
  try {
    const encKey = vault.encryptedPrivKeyPassphrase ?? vault.encryptedPrivateKey;
    const iv = vault.passphraseIv ?? vault.iv;
    privateKeyBuf = await decryptPrivKey(encKey, iv, passphraseMasterKey);
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  // 3. Register passkey with PRF
  const prfSalt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
  const userIdBytes = new TextEncoder().encode(userId);
  const { credentialId, prfOutput, supported } = await registerWithPRF(prfSalt, userIdBytes, userName);
  if (!supported) return { supported: false };

  // 4. Derive PRF master key + re-encrypt private key
  const prfMasterKey = await deriveKeyFromPRF(prfOutput);
  const { encryptedB64: encryptedPrivKeyPRF, ivB64: prfIv } = await encryptPrivKey(privateKeyBuf, prfMasterKey);

  // 5. PATCH vault — add PRF layer → vaultType: 'both'
  const patchRes = await fetch("/api/keys/vault/prf", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encryptedPrivKeyPRF, prfIv, prfSalt: toB64(prfSalt), credentialId }),
  });
  if (!patchRes.ok) {
    const data = await patchRes.json().catch(() => ({}));
    throw new Error(data.error || "Failed to add PRF layer");
  }

  return { supported: true };
}

// ──────────────────────────────────────
// UNLOCK: Passphrase
// ──────────────────────────────────────

export async function unlockVault(passphrase: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) throw new Error("Failed to fetch vault");
  const vault = await res.json();

  const encKey = vault.encryptedPrivKeyPassphrase ?? vault.encryptedPrivateKey;
  const iv = vault.passphraseIv ?? vault.iv;
  if (!encKey || !iv) throw new Error("Vault has no passphrase layer");

  const masterKey = await deriveKey(passphrase, fromB64(vault.pbkdf2Salt));
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await decryptPrivKey(encKey, iv, masterKey);
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(vault.publicKey);
  return { privateKey, publicKey };
}

// ──────────────────────────────────────
// UNLOCK: PRF passkey
// ──────────────────────────────────────

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
    privateKeyBuf = await decryptPrivKey(vault.encryptedPrivKeyPRF, vault.prfIv, masterKey);
  } catch {
    throw new Error("PRF_DECRYPT_FAILED");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(vault.publicKey);
  return { privateKey, publicKey };
}
