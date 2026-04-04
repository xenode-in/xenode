/**
 * lib/crypto/forgotPassword.ts
 * Main recovery orchestration for zero-knowledge password reset.
 */

import { deriveRecoveryKey } from "./recovery";
import { deriveKeyFromPassword } from "./keyUtils";
import { fromB64, toB64, bytesToHex } from "./utils";
import { buildVaultPassphrase } from "./keySetup";

const encoder = new TextEncoder();

/**
 * secureClear
 * Safely wipes sensitive data from memory.
 */
function secureClear(buf: Uint8Array | null) {
  if (buf) buf.fill(0);
}

/**
 * 🔐 MAIN RECOVERY FUNCTION
 */
export async function recoverPassword({
  recoveryKeywords,
  recoverySaltB64,
  recoveryWordIvB64,
  encryptedPrivateKeyB64,
  encryptedChallengeB64,
  newPassword,
}: {
  recoveryKeywords: string[];
  recoverySaltB64: string;
  recoveryWordIvB64: string;
  encryptedPrivateKeyB64: string;
  encryptedChallengeB64?: string;
  newPassword: string;
}) {
  // 1. Derive recovery key from keywords and the recovery-specific salt
  const recoveryKey = await deriveRecoveryKey(
    recoveryKeywords,
    recoverySaltB64
  );

  // 2. Decrypt the vault encrypted with recovery words
  const iv = fromB64(recoveryWordIvB64);
  const ciphertext = fromB64(encryptedPrivateKeyB64);

  const privateKeyBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      recoveryKey,
      ciphertext
    )
  );

  try {
    let recoveryProofB64: string | undefined;
    if (encryptedChallengeB64) {
      const recoveryPrivateKey = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBytes.buffer.slice(
          privateKeyBytes.byteOffset,
          privateKeyBytes.byteOffset + privateKeyBytes.byteLength,
        ) as ArrayBuffer,
        {
          name: "RSA-OAEP",
          hash: "SHA-256",
        },
        false,
        ["decrypt"],
      );

      const decryptedChallenge = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        recoveryPrivateKey,
        fromB64(encryptedChallengeB64),
      );
      recoveryProofB64 = toB64(new Uint8Array(decryptedChallenge));
    }

    // 4. Re-encrypt the original private key with the NEW password key (Main Vault)
    // IMPORTANT: Xenode vaults use a combined passphrase: masterPassword + recoveryWords
    const vaultPassphrase = buildVaultPassphrase(
      newPassword,
      recoveryKeywords.join(" ")
    );
    const passwordSalt = crypto.getRandomValues(new Uint8Array(16));
    const passwordKey = await deriveKeyFromPassword(
      vaultPassphrase,
      passwordSalt
    );

    const newIv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: newIv },
      passwordKey,
      privateKeyBytes
    );

    // 5. Re-encrypt the recovery keywords with the NEW password (Keywords Layer)
    // This is REQUIRED for the normal unlock process to "find" the keywords on next login.
    const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
    const recoveryKeyInternal = await deriveKeyFromPassword(newPassword, recoverySalt);
    const recoveryIv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedRecoveryWords = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: recoveryIv },
      recoveryKeyInternal,
      encoder.encode(recoveryKeywords.join(" "))
    );

    // 6. Re-encrypt the private key using ONLY recovery words (Backup Record)
    const recoveryWordSalt = crypto.getRandomValues(new Uint8Array(16));
    const recoveryOnlyKey = await deriveKeyFromPassword(recoveryKeywords.join(" "), recoveryWordSalt);
    const recoveryWordIv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedPrivKeyRecovery = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: recoveryWordIv },
      recoveryOnlyKey,
      privateKeyBytes
    );

    // 7. Generate Zero-Knowledge Auth Verifier
    const authSalt = crypto.getRandomValues(new Uint8Array(32));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(newPassword),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const verifierBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: authSalt,
        iterations: 200000,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );

    return {
      // Main Vault
      encryptedPrivateKeyB64: toB64(new Uint8Array(encrypted)),
      ivB64: toB64(newIv),
      passwordSaltB64: toB64(passwordSalt),
      
      // Keywords Layer
      encryptedRecoveryWordsB64: toB64(new Uint8Array(encryptedRecoveryWords)),
      recoveryIvB64: toB64(recoveryIv),
      recoverySaltB64: toB64(recoverySalt),

      // Backup Record
      encryptedPrivateKeyRecoveryB64: toB64(new Uint8Array(encryptedPrivKeyRecovery)),
      recoveryWordSaltB64: toB64(recoveryWordSalt),
      recoveryWordIvB64: toB64(recoveryWordIv),

      // Auth
      authVerifierHex: bytesToHex(new Uint8Array(verifierBits)),
      authSaltB64: toB64(authSalt),
      recoveryProofB64,
    };
  } finally {
    // 🔥 CRITICAL: wipe sensitive private key from memory immediately
    secureClear(privateKeyBytes);
  }
}
