/**
 * lib/crypto/keySetup.ts
 * Key vault setup and unlock — browser only.
 *
 * Vault passphrase = masterPassword + ":" + recoveryWords
 */

import { toB64, fromB64, deriveKey, hmacSha256 } from "./utils";

export const VAULT_VERSION = 2;

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

/** Combines master password + recovery words into a single passphrase for PBKDF2 */
export function buildVaultPassphrase(
  masterPassword: string,
  recoveryWords: string,
): string {
  return `${masterPassword}:${recoveryWords}`;
}

/**
 * setupUserKeyVault
 * Called once during onboarding.
 */
export async function setupUserKeyVault(
  masterPassword: string,
  recoveryWords: string,
  existingKeys?: { privateKeyBuf: ArrayBuffer; publicKeyBuf: ArrayBuffer },
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  const passphrase = buildVaultPassphrase(masterPassword, recoveryWords);

  let publicKeyBuf: ArrayBuffer;
  let privateKeyBuf: ArrayBuffer;
  let publicKey: CryptoKey;

  if (existingKeys) {
    publicKeyBuf = existingKeys.publicKeyBuf;
    privateKeyBuf = existingKeys.privateKeyBuf;
    publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyBuf,
      RSA_PARAMS,
      false,
      ["encrypt"],
    );
  } else {
    const keypair = await crypto.subtle.generateKey(RSA_PARAMS, true, [
      "encrypt",
      "decrypt",
    ]);
    publicKey = keypair.publicKey;
    publicKeyBuf = await crypto.subtle.exportKey("spki", keypair.publicKey);
    privateKeyBuf = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const masterKey = await deriveKey(passphrase, salt, "AES-GCM");
  const hmacKey = await deriveKey(passphrase, salt, "HMAC");

  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    privateKeyBuf,
  );

  // Sign the encrypted private key for integrity
  const vaultHmac = await hmacSha256(hmacKey, encryptedPrivKey);

  // Encrypt recovery words using a key derived ONLY from the master password
  const recoverySalt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const recoveryKey = await deriveKey(masterPassword, recoverySalt, "AES-GCM");
  const recoveryIv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;

  const encryptedRecoveryWordsBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: recoveryIv },
    recoveryKey,
    new TextEncoder().encode(recoveryWords),
  );

  // Encrypt the private key using a key derived ONLY from recovery words (for true recovery)
  const recoveryWordSalt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const recoveryOnlyKey = await deriveKey(recoveryWords, recoveryWordSalt, "AES-GCM");
  const recoveryWordIv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encryptedPrivKeyRecoveryBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: recoveryWordIv },
    recoveryOnlyKey,
    privateKeyBuf,
  );

  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: toB64(publicKeyBuf),
      encryptedPrivateKey: toB64(encryptedPrivKey),
      vaultHmac: toB64(vaultHmac),
      vaultVersion: VAULT_VERSION,
      pbkdf2Salt: toB64(salt),
      iv: toB64(iv),
      encryptedRecoveryWords: toB64(encryptedRecoveryWordsBuf),
      recoveryIv: toB64(recoveryIv),
      recoverySalt: toB64(recoverySalt),
      encryptedPrivateKeyRecovery: toB64(encryptedPrivKeyRecoveryBuf),
      recoveryWordSalt: toB64(recoveryWordSalt),
      recoveryWordIv: toB64(recoveryWordIv),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save vault");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuf,
    RSA_PARAMS,
    false,
    ["decrypt"],
  );

  const metadataKey = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", privateKeyBuf),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return { privateKey, publicKey, metadataKey };
}

/**
 * unlockVault
 * Called on new device / cleared IDB cache.
 */
export async function unlockVault(masterPassword: string): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch vault");
  }

  const {
    publicKey: publicKeyB64,
    encryptedPrivateKey,
    vaultHmac,
    vaultVersion,
    pbkdf2Salt,
    iv,
    encryptedRecoveryWords,
    recoveryIv,
    recoverySalt,
  } = await res.json();

  // Step 1: Derive a key from master password alone to decrypt the stored recovery words
  const recoveryKey = await deriveKey(masterPassword, fromB64(recoverySalt), "AES-GCM");
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

  // Step 2: Rebuild full passphrase
  const passphrase = buildVaultPassphrase(masterPassword, recoveryWords);
  const salt = fromB64(pbkdf2Salt);
  const masterKey = await deriveKey(passphrase, salt, "AES-GCM");
  const hmacKey = await deriveKey(passphrase, salt, "HMAC");

  const encryptedPrivateKeyBuf = fromB64(encryptedPrivateKey);

  // INTEGRITY CHECK (V2+)
  if (vaultVersion >= 2) {
    if (!vaultHmac) throw new Error("VAULT_TAMPERED");
    const computedHmac = await hmacSha256(hmacKey, encryptedPrivateKeyBuf);
    const storedHmac = fromB64(vaultHmac);
    
    // Constant-time check comparison (basic)
    const computedArr = new Uint8Array(computedHmac);
    const storedArr = new Uint8Array(storedHmac);
    if (computedArr.length !== storedArr.length) throw new Error("VAULT_TAMPERED");
    
    let mismatch = 0;
    for (let i = 0; i < computedArr.length; i++) {
      mismatch |= computedArr[i] ^ storedArr[i];
    }
    if (mismatch !== 0) throw new Error("VAULT_TAMPERED");
  }

  // Step 3: Decrypt the private key
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      masterKey,
      encryptedPrivateKeyBuf,
    );
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuf,
    RSA_PARAMS,
    false,
    ["decrypt"],
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    fromB64(publicKeyB64),
    RSA_PARAMS,
    false,
    ["encrypt"],
  );

  const metadataKey = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", privateKeyBuf),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return { privateKey, publicKey, metadataKey };
}

/**
 * regenerateVault
 */
export async function regenerateVault(
  newMasterPassword: string,
  recoveryWords: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  return setupUserKeyVault(newMasterPassword, recoveryWords);
}

/**
 * updateVaultPassword
 */
export async function updateVaultPassword(
  currentPassword: string,
  newMasterPassword: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  // Fetch latest to get recovery words
  const res = await fetch("/api/keys/vault");
  if (!res.ok) throw new Error("VAULT_FETCH_FAILED");
  const vault = await res.json();

  const recoveryKey = await deriveKey(currentPassword, fromB64(vault.recoverySalt), "AES-GCM");
  const recoveryWordsBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(vault.recoveryIv) },
    recoveryKey,
    fromB64(vault.encryptedRecoveryWords),
  );
  const recoveryWords = new TextDecoder().decode(recoveryWordsBuf);

  // Decrypt private key
  const passphrase = buildVaultPassphrase(currentPassword, recoveryWords);
  const masterKey = await deriveKey(passphrase, fromB64(vault.pbkdf2Salt), "AES-GCM");
  const privateKeyBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(vault.iv) },
    masterKey,
    fromB64(vault.encryptedPrivateKey),
  );

  return setupUserKeyVault(newMasterPassword, recoveryWords, {
    privateKeyBuf,
    publicKeyBuf: fromB64(vault.publicKey).buffer,
  });
}

/**
 * recoverAndResetVault
 */
export async function recoverAndResetVault(
  recoveryWords: string,
  newMasterPassword: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  const res = await fetch("/api/keys/vault");
  if (!res.ok) throw new Error("VAULT_FETCH_FAILED");
  const vault = await res.json();

  if (!vault.encryptedPrivateKeyRecovery) throw new Error("RECOVERY_NOT_CONFIGURED");

  const recoveryOnlyKey = await deriveKey(recoveryWords, fromB64(vault.recoveryWordSalt), "AES-GCM");
  const privateKeyBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(vault.recoveryWordIv) },
    recoveryOnlyKey,
    fromB64(vault.encryptedPrivateKeyRecovery),
  );

  return setupUserKeyVault(newMasterPassword, recoveryWords, {
    privateKeyBuf,
    publicKeyBuf: fromB64(vault.publicKey).buffer,
  });
}
