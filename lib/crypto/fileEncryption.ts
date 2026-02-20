/**
 * lib/crypto/fileEncryption.ts
 * Client-side file encrypt / decrypt helpers — browser only.
 */

import { toB64, fromB64 } from "./utils";

export interface EncryptedFileResult {
  /** Encrypted file bytes (AES-256-GCM ciphertext + 16-byte auth tag) */
  ciphertext: Blob;
  /** Base64-encoded RSA-OAEP wrapped AES DEK */
  encryptedDEK: string;
  /** Base64-encoded 12-byte GCM IV */
  iv: string;
}

/**
 * Encrypt a File with a fresh random AES-256-GCM DEK.
 * The DEK is then wrapped with the user's RSA-OAEP public key.
 */
export async function encryptFile(
  file: File,
  publicKey: CryptoKey,
): Promise<EncryptedFileResult> {
  // 1. Generate a random AES-256-GCM DEK for this file
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  // 2. Encrypt the file content
  const iv = crypto.getRandomValues(
    new Uint8Array(12),
  ) as Uint8Array<ArrayBuffer>;
  const plaintext = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    plaintext,
  );

  // 3. Wrap the DEK with the user's RSA public key
  const rawDEK = await crypto.subtle.exportKey("raw", dek);
  const wrappedDEK = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    rawDEK,
  );

  return {
    ciphertext: new Blob([ciphertext], { type: "application/octet-stream" }),
    encryptedDEK: toB64(wrappedDEK),
    iv: toB64(iv),
  };
}

/**
 * Decrypt an encrypted file blob.
 * Unwraps the DEK with the user's RSA private key, then decrypts the ciphertext.
 */
export async function decryptFile(
  ciphertext: ArrayBuffer,
  encryptedDEK: string,
  iv: string,
  privateKey: CryptoKey,
  contentType: string,
): Promise<Blob> {
  // 1. Unwrap DEK with private key
  const wrappedDEKBytes = fromB64(encryptedDEK);
  const rawDEK = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    wrappedDEKBytes,
  );

  // 2. Import DEK
  const dek = await crypto.subtle.importKey(
    "raw",
    rawDEK,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  // 3. Decrypt file
  const ivBytes = fromB64(iv) as Uint8Array<ArrayBuffer>;
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    dek,
    ciphertext,
  );

  return new Blob([plaintext], { type: contentType });
}
