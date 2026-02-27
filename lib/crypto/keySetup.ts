/**
 * lib/crypto/keySetup.ts
 * Key vault setup and unlock — browser only.
 *
 * Two paths:
 *   1. PRF path  — passkey biometric → PRF output → HKDF → Master Key (preferred)
 *   2. Passphrase path — password → PBKDF2 → Master Key (fallback)
 *
 * The vault schema on the server stores:
 *   { publicKey, encryptedPrivateKey, pbkdf2Salt, iv, prfSalt?, vaultType }
 */

import { toB64, fromB64, deriveKey } from "./utils";
import {
  registerWithPRF,
  authenticateWithPRF,
  deriveKeyFromPRF,
} from "./prf";

export type VaultType = "prf" | "passphrase";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function generateAndEncryptKeypair(masterKey: CryptoKey): Promise<{
  publicKeyB64: string;
  encryptedPrivKeyB64: string;
  ivB64: string;
  privateKeyBuf: ArrayBuffer;
}> {
  const keypair = await crypto.subtle.generateKey(RSA_PARAMS, true, [
    "encrypt",
    "decrypt",
  ]);
  const publicKeyBuf = await crypto.subtle.exportKey("spki", keypair.publicKey);
  const privateKeyBuf = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    privateKeyBuf,
  );
  return {
    publicKeyB64: toB64(publicKeyBuf),
    encryptedPrivKeyB64: toB64(encryptedPrivKey),
    ivB64: toB64(iv),
    privateKeyBuf,
  };
}

async function importPrivateKey(privateKeyBuf: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", privateKeyBuf, RSA_PARAMS, false, ["decrypt"]);
}

async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", fromB64(publicKeyB64), RSA_PARAMS, false, ["encrypt"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRF PATH (primary — zero passphrase)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a passkey WITH PRF, use the PRF output as Master Key,
 * generate RSA keypair, encrypt it, and POST vault to server.
 *
 * @param userId   - Better Auth user ID string
 * @param userName - user's email or display name
 * @returns { privateKey, publicKey, supported } — supported=false if PRF unavailable
 */
export async function setupVaultWithPRF(
  userId: string,
  userName: string,
): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  supported: boolean;
}> {
  // Generate a random per-user PRF salt (stored on server alongside vault)
  const prfSalt = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;

  // Encode userId as bytes for WebAuthn userHandle
  const userIdBytes = new TextEncoder().encode(userId);

  const { credentialId, prfOutput, supported } = await registerWithPRF(
    prfSalt,
    userIdBytes,
    userName,
  );

  if (!supported) {
    // PRF not supported — caller should fall back to passphrase path
    return { privateKey: null as unknown as CryptoKey, publicKey: null as unknown as CryptoKey, supported: false };
  }

  const masterKey = await deriveKeyFromPRF(prfOutput);
  const { publicKeyB64, encryptedPrivKeyB64, ivB64, privateKeyBuf } =
    await generateAndEncryptKeypair(masterKey);

  // POST vault — includes prfSalt and vaultType
  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: publicKeyB64,
      encryptedPrivateKey: encryptedPrivKeyB64,
      pbkdf2Salt: toB64(new Uint8Array(16)), // placeholder (not used in PRF path)
      iv: ivB64,
      prfSalt: toB64(prfSalt),
      credentialId,
      vaultType: "prf",
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save key vault");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(publicKeyB64);

  return { privateKey, publicKey, supported: true };
}

/**
 * Unlock vault using PRF — trigger passkey biometric, get PRF output,
 * derive Master Key, decrypt private key.
 */
export async function unlockVaultWithPRF(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch key vault");
  }

  const { publicKey: publicKeyB64, encryptedPrivateKey, prfSalt, iv } = await res.json();

  if (!prfSalt) throw new Error("NOT_PRF_VAULT");

  const { prfOutput, supported } = await authenticateWithPRF(fromB64(prfSalt));
  if (!supported) throw new Error("PRF_NOT_SUPPORTED");

  const masterKey = await deriveKeyFromPRF(prfOutput);

  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      masterKey,
      fromB64(encryptedPrivateKey),
    );
  } catch {
    throw new Error("PRF_DECRYPT_FAILED");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(publicKeyB64);

  return { privateKey, publicKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSPHRASE PATH (fallback for Windows Hello / Firefox / non-PRF browsers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new RSA keypair, encrypt with PBKDF2-derived key, POST to server.
 */
export async function setupUserKeyVault(password: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const masterKey = await deriveKey(password, salt);
  const { publicKeyB64, encryptedPrivKeyB64, ivB64, privateKeyBuf } =
    await generateAndEncryptKeypair(masterKey);

  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: publicKeyB64,
      encryptedPrivateKey: encryptedPrivKeyB64,
      pbkdf2Salt: toB64(salt),
      iv: ivB64,
      vaultType: "passphrase",
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save key vault");
  }

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(publicKeyB64);
  return { privateKey, publicKey };
}

/**
 * Fetch vault + decrypt private key using PBKDF2-derived master key.
 */
export async function unlockVault(password: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch vault");
  }

  const { publicKey: publicKeyB64, encryptedPrivateKey, pbkdf2Salt, iv } =
    await res.json();

  const masterKey = await deriveKey(password, fromB64(pbkdf2Salt));

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

  const privateKey = await importPrivateKey(privateKeyBuf);
  const publicKey = await importPublicKey(publicKeyB64);
  return { privateKey, publicKey };
}
