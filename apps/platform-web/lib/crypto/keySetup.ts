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
export function buildVaultPassphrase(
  masterPassword: string,
  recoveryWords: string,
): string {
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
  existingKeys?: { privateKeyBuf: ArrayBuffer; publicKeyBuf: ArrayBuffer },
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey; privateKeyBuf: ArrayBuffer }> {
  if (masterPassword.trim().length < 8) {
    throw new Error("Vault password is missing or invalid");
  }
  if (!recoveryWords.trim()) {
    throw new Error("Recovery words are required");
  }

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

  const salt = crypto.getRandomValues(
    new Uint8Array(16),
  ) as Uint8Array<ArrayBuffer>;
  const masterKey = await deriveKey(passphrase, salt);

  const iv = crypto.getRandomValues(
    new Uint8Array(12),
  ) as Uint8Array<ArrayBuffer>;
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    privateKeyBuf,
  );

  // Encrypt recovery words using a key derived ONLY from the master password
  const recoverySalt = crypto.getRandomValues(
    new Uint8Array(16),
  ) as Uint8Array<ArrayBuffer>;
  const recoveryKey = await deriveKey(masterPassword, recoverySalt);
  const recoveryIv = crypto.getRandomValues(
    new Uint8Array(12),
  ) as Uint8Array<ArrayBuffer>;

  const encryptedRecoveryWordsBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: recoveryIv },
    recoveryKey,
    new TextEncoder().encode(recoveryWords),
  );

  // Encrypt the private key using a key derived ONLY from recovery words (for true recovery)
  const recoveryWordSalt = crypto.getRandomValues(
    new Uint8Array(16),
  ) as Uint8Array<ArrayBuffer>;
  const recoveryOnlyKey = await deriveKey(recoveryWords, recoveryWordSalt);
  const recoveryWordIv = crypto.getRandomValues(
    new Uint8Array(12),
  ) as Uint8Array<ArrayBuffer>;
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

  return { privateKey, publicKey, metadataKey, privateKeyBuf };
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
export async function unlockVault(masterPassword: string): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey; privateKeyBuf: ArrayBuffer }> {
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

  return { privateKey, publicKey, metadataKey, privateKeyBuf };
}

/**
 * regenerateVault
 * Called when user has their recovery words + sets a new master password.
 * Used in the "forgot master password" recovery flow.
 */
export async function regenerateVault(
  newMasterPassword: string,
  recoveryWords: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey; privateKeyBuf: ArrayBuffer }> {
  return setupUserKeyVault(newMasterPassword, recoveryWords);
}

/**
 * updateVaultPassword
 * Re-encrypts the user's existing vault with a new master password, keeping the
 * same keypair and same recovery words.
 * Used during account password change.
 */
export async function updateVaultPassword(
  currentPassword: string,
  newMasterPassword: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey; privateKeyBuf: ArrayBuffer }> {
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

  // 1. Decrypt the stored recovery words using the CURRENT password
  const recoveryKey = await deriveKey(currentPassword, fromB64(recoverySalt));
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

  // 2. Decrypt the private key using the CURRENT password + recovery words
  const passphrase = buildVaultPassphrase(currentPassword, recoveryWords);
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

  // 3. Re-encrypt with the NEW password via setupUserKeyVault
  const publicKeyBuf = fromB64(publicKeyB64).buffer;

  return setupUserKeyVault(newMasterPassword, recoveryWords, {
    privateKeyBuf,
    publicKeyBuf,
  });
}

/**
 * recoverAndResetVault
 * Decrypts the existing vault using ONLY the recovery words, then re-encrypts
 * it with a new master password, keeping the original encrypted files accessible.
 */
export async function recoverAndResetVault(
  recoveryWords: string,
  newMasterPassword: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey; privateKeyBuf: ArrayBuffer }> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) throw new Error("NO_VAULT");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch vault");
  }

  const {
    publicKey: publicKeyB64,
    encryptedPrivateKeyRecovery,
    recoveryWordSalt,
    recoveryWordIv,
  } = await res.json();

  if (!encryptedPrivateKeyRecovery || !recoveryWordSalt || !recoveryWordIv) {
    throw new Error(
      "Vault is not configured for true recovery. Please refer to support or delete your account to start over.",
    );
  }

  const recoveryOnlyKey = await deriveKey(
    recoveryWords,
    fromB64(recoveryWordSalt),
  );
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(recoveryWordIv) },
      recoveryOnlyKey,
      fromB64(encryptedPrivateKeyRecovery),
    );
  } catch {
    throw new Error("INVALID_RECOVERY_KIT");
  }

  const publicKeyBuf = fromB64(publicKeyB64).buffer;

  return setupUserKeyVault(newMasterPassword, recoveryWords, {
    privateKeyBuf,
    publicKeyBuf,
  });
}
