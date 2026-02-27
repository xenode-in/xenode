/**
 * lib/crypto/keySetup.ts
 *
 * Vault setup / unlock for Xenode E2EE.
 *
 * Vault types:
 *   'passphrase' — encrypted with PBKDF2 passphrase only
 *   'prf'        — encrypted with WebAuthn PRF passkey only
 *   'both'       — encrypted with BOTH (either unlocks it)
 *
 * Onboarding:
 *   Primary   → setupVaultWithPRF(userId, userName)   → vaultType: 'prf'
 *   Fallback  → setupUserKeyVault(passphrase)         → vaultType: 'passphrase'
 *
 * Post-onboarding (Settings or unlock fallback):
 *   PRF user adds passphrase  → addPassphraseLayerToVault(newPassphrase)
 *   Passphrase user adds PRF  → addPRFLayerToVault(passphrase, userId, userName)
 *
 * Unlock:
 *   'prf'        → unlockVaultWithPRF()       (passkey biometric)
 *   'passphrase' → unlockVault(passphrase)
 *   'both'       → try PRF silently → fallback to passphrase
 */

import { toB64, fromB64, deriveKey } from "./utils";
import { registerWithPRF, authenticateWithPRF, deriveKeyFromPRF } from "./prf";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

// ─── Internal helpers ────────────────────────────────────────────────────────

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

// ─── ONBOARDING PRIMARY: new PRF vault ──────────────────────────────────────

/**
 * Called from OnboardingForm primary path.
 * Generates keypair, registers passkey with PRF, saves vault (vaultType: 'prf').
 * Does NOT require an existing vault.
 */
export async function setupVaultWithPRF(
  userId: string,
  userName: string,
): Promise<{ supported: boolean; privateKey?: CryptoKey; publicKey?: CryptoKey }> {
  const { privateKeyBuf, publicKeyBuf } = await generateKeypair();
  const prfSalt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
  const userIdBytes = new TextEncoder().encode(userId);

  const { credentialId, prfOutput, supported } = await registerWithPRF(prfSalt, userIdBytes, userName);
  if (!supported) return { supported: false };

  const masterKey = await deriveKeyFromPRF(prfOutput);
  const { encryptedB64, ivB64 } = await encryptPrivKey(privateKeyBuf, masterKey);

  // pbkdf2Salt stored as empty placeholder — required by schema but unused for prf-only
  const dummySalt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;

  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: toB64(publicKeyBuf),
      pbkdf2Salt: toB64(dummySalt),
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

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(toB64(publicKeyBuf));
  return { supported: true, privateKey, publicKey };
}

// ─── ONBOARDING FALLBACK: new passphrase vault ──────────────────────────────

/**
 * Called from OnboardingForm fallback path.
 * Generates keypair, encrypts with passphrase, saves vault (vaultType: 'passphrase').
 * Does NOT require an existing vault.
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

// ─── ADD PASSPHRASE LAYER to existing PRF vault ─────────────────────────────

/**
 * Called when a PRF-only user wants to add a passphrase backup.
 * (From UnlockVaultModal fallback OR Settings)
 *
 * Flow:
 *  1. Unlock existing vault via PRF (passkey biometric)
 *  2. Re-encrypt same private key with new PBKDF2 passphrase
 *  3. PATCH /api/keys/vault/passphrase → vaultType: 'both'
 */
export async function addPassphraseLayerToVault(newPassphrase: string): Promise<void> {
  // 1. Fetch vault
  const res = await fetch("/api/keys/vault");
  if (!res.ok) throw new Error("No vault found.");
  const vault = await res.json();

  if (!vault.prfSalt || !vault.encryptedPrivKeyPRF || !vault.prfIv) {
    throw new Error("NOT_PRF_VAULT");
  }

  // 2. Unlock with PRF to get raw private key
  const { prfOutput, supported } = await authenticateWithPRF(fromB64(vault.prfSalt));
  if (!supported) throw new Error("PRF_NOT_SUPPORTED");

  const prfMasterKey = await deriveKeyFromPRF(prfOutput);
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await decryptPrivKey(vault.encryptedPrivKeyPRF, vault.prfIv, prfMasterKey);
  } catch {
    throw new Error("PRF_DECRYPT_FAILED");
  }

  // 3. Re-encrypt same private key with new passphrase
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const passphraseMasterKey = await deriveKey(newPassphrase, salt);
  const { encryptedB64, ivB64 } = await encryptPrivKey(privateKeyBuf, passphraseMasterKey);

  // 4. PATCH vault — add passphrase layer → vaultType: 'both'
  const patchRes = await fetch("/api/keys/vault/passphrase", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encryptedPrivKeyPassphrase: encryptedB64,
      passphraseIv: ivB64,
      pbkdf2Salt: toB64(salt),
    }),
  });
  if (!patchRes.ok) {
    const data = await patchRes.json().catch(() => ({}));
    throw new Error(data.error || "Failed to add passphrase layer");
  }
}

// ─── ADD PRF LAYER to existing passphrase vault ──────────────────────────────

/**
 * Called when a passphrase-only user wants to add a passkey.
 * (From Settings only — user must be unlocked/authenticated already)
 *
 * Flow:
 *  1. Unlock existing vault with passphrase to get raw private key
 *  2. Register new passkey with PRF
 *  3. Re-encrypt same private key with PRF master key
 *  4. PATCH /api/keys/vault/prf → vaultType: 'both'
 */
export async function addPRFLayerToVault(
  passphrase: string,
  userId: string,
  userName: string,
): Promise<{ supported: boolean }> {
  const res = await fetch("/api/keys/vault");
  if (!res.ok) throw new Error("No vault found.");
  const vault = await res.json();

  const encKey = vault.encryptedPrivKeyPassphrase ?? vault.encryptedPrivateKey;
  const iv = vault.passphraseIv ?? vault.iv;
  if (!encKey || !iv) throw new Error("Vault has no passphrase layer");

  const passphraseMasterKey = await deriveKey(passphrase, fromB64(vault.pbkdf2Salt));
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await decryptPrivKey(encKey, iv, passphraseMasterKey);
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  const prfSalt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
  const userIdBytes = new TextEncoder().encode(userId);
  const { credentialId, prfOutput, supported } = await registerWithPRF(prfSalt, userIdBytes, userName);
  if (!supported) return { supported: false };

  const prfMasterKey = await deriveKeyFromPRF(prfOutput);
  const { encryptedB64: encryptedPrivKeyPRF, ivB64: prfIv } = await encryptPrivKey(privateKeyBuf, prfMasterKey);

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

// ─── UNLOCK: passphrase ──────────────────────────────────────────────────────

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

// ─── UNLOCK: PRF passkey ─────────────────────────────────────────────────────

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
