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
  console.log("[decryptFile] Starting decryption...");
  console.log("[decryptFile] Ciphertext byteLength:", ciphertext.byteLength);
  console.log("[decryptFile] IV length:", iv.length);
  console.log("[decryptFile] Encrypted DEK length:", encryptedDEK.length);
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

  console.log("[decryptFile] DEK imported successfully.");

  // 3. Decrypt file
  const ivBytes = fromB64(iv) as Uint8Array<ArrayBuffer>;
  console.log("[decryptFile] IV Bytes length:", ivBytes.byteLength);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      dek,
      ciphertext,
    );
    console.log("[decryptFile] Decryption successful!");
    return new Blob([plaintext], { type: contentType });
  } catch (err: unknown) {
    console.error(
      "[decryptFile] OperationError thrown during AES-GCM decrypt:",
    );
    console.error(err);
    throw err;
  }
}

/**
 * Decrypts a file encrypted using `encryptFileChunked` by rebuilding the entire blob in memory.
 * Suitable for previewing full files (like rendering images or PDFs on standard viewers)
 * without needing full MediaSource streaming infrastructure if not available.
 */
export async function decryptFileChunkedCombined(
  ciphertext: ArrayBuffer,
  encryptedDEK: string,
  chunkIvsStr: string,
  chunkSize: number,
  chunkCount: number,
  privateKey: CryptoKey,
  contentType: string,
): Promise<Blob> {
  const wrappedDEKBytes = fromB64(encryptedDEK);
  const rawDEK = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    wrappedDEKBytes,
  );

  const dek = await crypto.subtle.importKey(
    "raw",
    rawDEK,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const chunkIvs: string[] = JSON.parse(chunkIvsStr);
  const decryptedChunks: ArrayBuffer[] = [];

  // Decrypt each chunk independently
  for (let i = 0; i < chunkCount; i++) {
    // Note: Ciphertext chunks expand by 16 bytes (AES-GCM Auth Tag)
    const cipherChunkSize = chunkSize + 16;
    const start = i * cipherChunkSize;
    const end = Math.min(start + cipherChunkSize, ciphertext.byteLength);
    const slice = ciphertext.slice(start, end);

    const decrypted = await decryptChunk(slice, dek, chunkIvs[i]);
    decryptedChunks.push(decrypted);
  }

  return new Blob(decryptedChunks, { type: contentType });
}

export interface EncryptedFileChunkedResult {
  /** Single concatenated blob of all encrypted chunks */
  ciphertext: Blob;
  /** Base64 RSA-OAEP wrapped AES-256 DEK (same key used for all chunks) */
  encryptedDEK: string;
  /** Plaintext bytes per chunk (last chunk may be smaller) */
  chunkSize: number;
  /** Total number of chunks */
  chunkCount: number;
  /**
   * Per-chunk GCM IVs as Base64 strings.
   * Length === chunkCount. Stored in DB as JSON.stringify(chunkIvs).
   */
  chunkIvs: string[];
}

/**
 * Encrypt a File with chunked AES-256-GCM — MEGA style.
 *
 * A single random DEK is generated for the whole file.  The plaintext is split
 * into fixed-size slices (default 1 MiB). Each slice is encrypted independently
 * with its own random 12-byte IV.  The resulting ciphertext chunks are
 * concatenated into one Blob ready for a single PUT to B2.
 *
 * At download time the client reads the stored `chunkSize` and `chunkIvs` to
 * locate and decrypt individual chunks — enabling MediaSource streaming without
 * downloading the whole file first.
 *
 * @param file       The plaintext File to encrypt.
 * @param publicKey  The user's RSA-OAEP public key used to wrap the DEK.
 * @param chunkSize  Plaintext bytes per chunk. Default: 1 048 576 (1 MiB).
 */
export async function encryptFileChunked(
  file: File,
  publicKey: CryptoKey,
  chunkSize = 1_048_576,
): Promise<EncryptedFileChunkedResult> {
  // 1. Generate one shared DEK for the whole file
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const plaintext = await file.arrayBuffer();
  const chunkCount = Math.ceil(plaintext.byteLength / chunkSize);

  const chunkIvs: string[] = [];
  const encryptedChunks: ArrayBuffer[] = [];

  // 2. Encrypt each chunk with a fresh 12-byte random IV
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, plaintext.byteLength);
    const slice = plaintext.slice(start, end);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherChunk = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      dek,
      slice,
    );

    chunkIvs.push(toB64(iv));
    encryptedChunks.push(cipherChunk);
  }

  // 3. Wrap the DEK with the user's RSA public key
  const rawDEK = await crypto.subtle.exportKey("raw", dek);
  const wrappedDEK = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    rawDEK,
  );

  return {
    ciphertext: new Blob(encryptedChunks, { type: "application/octet-stream" }),
    encryptedDEK: toB64(wrappedDEK),
    chunkSize,
    chunkCount,
    chunkIvs,
  };
}

/**
 * Decrypt a single AES-GCM chunk.
 *
 * Call this once per chunk during MediaSource streaming to decrypt
 * each chunk in turn without waiting for the full file.
 *
 * @param cipherChunk  The raw ciphertext bytes for this chunk (including 16-byte tag).
 * @param dek          The extracted AES-256-GCM CryptoKey for this file.
 * @param ivB64        The Base64-encoded 12-byte IV for this specific chunk.
 */
export async function decryptChunk(
  cipherChunk: ArrayBuffer,
  dek: CryptoKey,
  ivB64: string,
): Promise<ArrayBuffer> {
  const iv = fromB64(ivB64) as Uint8Array<ArrayBuffer>;
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, dek, cipherChunk);
}

/**
 * Decrypts a filename that was encrypted during upload.
 * The b64 string contains: [nameKey(32 bytes)] + [nameIV(12 bytes)] + [ciphertext]
 */
export async function decryptFileName(
  encryptedNameB64: string,
): Promise<string> {
  try {
    const combined = fromB64(encryptedNameB64);
    if (combined.byteLength < 44) return "Unknown File";

    const nameKeyBytes = combined.slice(0, 32);
    const nameIV = combined.slice(32, 44);
    const ciphertext = combined.slice(44);

    const key = await crypto.subtle.importKey(
      "raw",
      nameKeyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nameIV },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(plaintext);
  } catch (err) {
    console.warn("[E2EE] Failed to decrypt file name", err);
    return "Encrypted File";
  }
}
