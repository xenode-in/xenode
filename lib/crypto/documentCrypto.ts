/**
 * lib/crypto/documentCrypto.ts
 *
 * Whole-document AES-256-GCM encryption for the BlockNote document editor.
 *
 * Runs ONLY in the browser (Web Crypto API). Plaintext document bytes are held
 * in memory by the caller and never touch the network, disk, or any browser
 * storage — only the encrypted blob produced here ever leaves the page.
 *
 * Self-contained blob format:  [ 12-byte IV ][ ciphertext (incl. GCM auth tag) ]
 *
 * This mirrors the existing concat convention already used elsewhere in the
 * E2EE layer (see encryptWithShareKey()/encryptThumbnail()/encryptMetadataString()
 * in ./fileEncryption.ts) — we keep the same shape so document blobs stay
 * consistent with the rest of the crypto stack. A fresh, random IV is generated
 * on EVERY encrypt; IVs are never reused.
 */

/** 96-bit nonce — the recommended IV size for AES-GCM. */
const IV_LENGTH = 12;

/**
 * Encrypt a plaintext document buffer with the given AES-GCM key.
 *
 * @returns concat(iv, ciphertext) as a fresh ArrayBuffer.
 */
export async function encryptDocument(
  buffer: ArrayBuffer,
  key: CryptoKey,
): Promise<ArrayBuffer> {
  // Fresh IV per encryption — getRandomValues, never reused.
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    buffer,
  );

  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return combined.buffer;
}

/**
 * Decrypt a document blob produced by {@link encryptDocument}.
 *
 * Extracts the leading 12-byte IV, decrypts the remainder, and returns the
 * plaintext ArrayBuffer. Throws a descriptive error if decryption fails (wrong
 * key or corrupted/tampered blob) — it NEVER returns partial or unauthenticated
 * content. AES-GCM authentication guarantees that a successful return means the
 * bytes are exactly what was encrypted.
 */
export async function decryptDocument(
  blob: ArrayBuffer,
  key: CryptoKey,
): Promise<ArrayBuffer> {
  if (blob.byteLength <= IV_LENGTH) {
    throw new Error(
      "Encrypted document is too small to contain an IV — the file is empty or corrupted.",
    );
  }

  const bytes = new Uint8Array(blob);
  const iv = bytes.subarray(0, IV_LENGTH);
  const ciphertext = bytes.subarray(IV_LENGTH);

  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    // GCM tag verification failed: incorrect key, or the blob was truncated /
    // tampered with. Surface loudly so the UI can refuse to render partial data.
    throw new Error(
      "Failed to decrypt document. The encryption key may be incorrect or the file is corrupted.",
    );
  }
}
