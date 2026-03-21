/**
 * lib/crypto/fileEncryption.ts
 */

import { toB64, fromB64 } from "./utils";

export interface EncryptedFileResult {
  ciphertext: Blob;
  encryptedDEK: string;
  iv: string;
}

export async function encryptFile(
  file: File,
  publicKey: CryptoKey,
): Promise<EncryptedFileResult> {
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const plaintext = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, plaintext);

  const rawDEK = await crypto.subtle.exportKey("raw", dek);
  const wrappedDEK = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawDEK);

  return {
    ciphertext: new Blob([ciphertext], { type: "application/octet-stream" }),
    encryptedDEK: toB64(wrappedDEK),
    iv: toB64(iv),
  };
}

export async function decryptFile(
  ciphertext: ArrayBuffer,
  encryptedDEK: string,
  iv: string,
  privateKey: CryptoKey,
  contentType: string,
): Promise<Blob> {
  const wrappedDEKBytes = fromB64(encryptedDEK);
  const rawDEK = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrappedDEKBytes);

  const dek = await crypto.subtle.importKey(
    "raw", rawDEK, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );

  const ivBytes = fromB64(iv) as Uint8Array<ArrayBuffer>;
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, dek, ciphertext);
  return new Blob([plaintext], { type: contentType });
}

export async function decryptFileChunkedCombined(
  ciphertext: ArrayBuffer,
  encryptedDEK: string,
  chunkIvsStr: string | string[],
  chunkSize: number,
  chunkCount: number,
  privateKey: CryptoKey,
  contentType: string,
): Promise<Blob> {
  const wrappedDEKBytes = fromB64(encryptedDEK);
  const rawDEK = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrappedDEKBytes);

  const dek = await crypto.subtle.importKey(
    "raw", rawDEK, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );

  const chunkIvs: string[] = typeof chunkIvsStr === "string" ? JSON.parse(chunkIvsStr) : chunkIvsStr;
  const decryptedChunks: ArrayBuffer[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const cipherChunkSize = chunkSize + 16;
    const start = i * cipherChunkSize;
    const end = Math.min(start + cipherChunkSize, ciphertext.byteLength);
    const slice = ciphertext.slice(start, end);
    decryptedChunks.push(await decryptChunk(slice, dek, chunkIvs[i]));
  }

  return new Blob(decryptedChunks, { type: contentType });
}

export interface EncryptedFileChunkedResult {
  ciphertext: Blob;
  encryptedDEK: string;
  chunkSize: number;
  chunkCount: number;
  chunkIvs: string[];
}

export async function encryptFileChunked(
  file: File,
  publicKey: CryptoKey,
  chunkSize = 1_048_576,
): Promise<EncryptedFileChunkedResult> {
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );

  const plaintext = await file.arrayBuffer();
  const chunkCount = Math.ceil(plaintext.byteLength / chunkSize);

  const chunkIvs: string[] = new Array(chunkCount);
  const encryptedChunks: ArrayBuffer[] = new Array(chunkCount);

  const concurrency = 4;
  let currentIndex = 0;

  const encryptWorker = async () => {
    while (currentIndex < chunkCount) {
      const i = currentIndex++;
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, plaintext.byteLength);
      const slice = plaintext.slice(start, end);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipherChunk = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, slice);
      chunkIvs[i] = toB64(iv);
      encryptedChunks[i] = cipherChunk;
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, chunkCount) }, () => encryptWorker());
  await Promise.all(workers);

  const rawDEK = await crypto.subtle.exportKey("raw", dek);
  const wrappedDEK = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawDEK);

  return {
    ciphertext: new Blob(encryptedChunks, { type: "application/octet-stream" }),
    encryptedDEK: toB64(wrappedDEK),
    chunkSize,
    chunkCount,
    chunkIvs,
  };
}

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

/**
 * Encrypt a thumbnail (Data URL) using the metadataKey
 */
export async function encryptThumbnail(
  dataUrl: string,
  metadataKey: CryptoKey,
): Promise<string> {
  const encoded = new TextEncoder().encode(dataUrl);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    metadataKey,
    encoded,
  );
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), 12);
  return "enc:" + toB64(combined);
}

/**
 * Decrypts a thumbnail encrypted with encryptThumbnail().
 * Returns the original data URL unchanged if not encrypted (no "enc:" prefix).
 */
export async function decryptThumbnail(
  thumbnail: string,
  metadataKey: CryptoKey,
): Promise<string> {
  if (!thumbnail.startsWith("enc:")) return thumbnail;
  try {
    const bytes = fromB64(thumbnail.slice(4));
    const iv = bytes.slice(0, 12);
    const cipher = bytes.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      metadataKey,
      cipher,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

/**
 * Encrypts a metadata string using a raw AES-GCM key (the share DEK).
 * Used to re-encrypt filename/contentType/thumbnail for public share pages
 * that have no vault access.
 */
export async function encryptWithShareKey(
  text: string,
  shareKey: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    shareKey,
    new TextEncoder().encode(text),
  );
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), 12);
  return toB64(combined);
}

export async function decryptWithShareKey(
  b64: string,
  shareKey: CryptoKey,
): Promise<string> {
  const bytes = fromB64(b64);
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    shareKey,
    cipher,
  );
  return new TextDecoder().decode(plain);
}

/**
 * Encrypts a string using the shared metadataKey.
 * Format: [0x02 version byte] + [12 bytes IV] + [ciphertext]
 */
export async function encryptMetadataString(
  text: string,
  metadataKey: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, metadataKey, encoded,
  );

  // 0x02 = new metadataKey format. Distinguishes from legacy format unambiguously.
  const combined = new Uint8Array(1 + iv.length + ciphertextBuffer.byteLength);
  combined[0] = 0x02;
  combined.set(iv, 1);
  combined.set(new Uint8Array(ciphertextBuffer), 1 + iv.length);
  return toB64(combined);
}

/**
 * Decrypts a metadata string.
 * Handles:
 *   - New format:    [0x02] + [12 bytes IV] + [ciphertext]  → uses metadataKey
 *   - Legacy format: [32 bytes AES key] + [12 bytes IV] + [ciphertext] → self-contained
 */
export async function decryptMetadataString(
  encryptedB64: string,
  metadataKey: CryptoKey | null,
): Promise<string> {
  try {
    const combined = fromB64(encryptedB64);

    // New format: version byte 0x02
    if (combined[0] === 0x02) {
      if (!metadataKey) return "Encrypted File";
      const iv = combined.slice(1, 13);
      const ciphertext = combined.slice(13);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv }, metadataKey, ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    }

    // Legacy format: first 32 bytes are a raw AES key
    if (combined.byteLength >= 44) {
      const nameKeyBytes = combined.slice(0, 32);
      const nameIV = combined.slice(32, 44);
      const ciphertext = combined.slice(44);
      const legacyKey = await crypto.subtle.importKey(
        "raw", nameKeyBytes, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
      );
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nameIV }, legacyKey, ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    }

    return "Encrypted File";
  } catch (err) {
    console.warn("[E2EE] Failed to decrypt metadata string", err);
    return "Encrypted File";
  }
}
