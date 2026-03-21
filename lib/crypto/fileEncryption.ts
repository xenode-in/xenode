/**
 * lib/crypto/fileEncryption.ts
 */

import { toB64, fromB64, CRYPTO_VERSION, MetadataEnvelope, packEnvelope, unpackEnvelope } from "./utils";

export interface EncryptedFileResult {
  ciphertext: Blob;
  encryptedDEK: string;
  iv: string;
}

export interface AADParams {
  userId: string;
  bucketId: string;
  objectKey: string;
  version?: number;
  chunkIndex?: number;
  totalChunks?: number;
}

/**
 * Builds a deterministic AAD string for AES-GCM binding.
 * Format: userId|bucketId|objectKey|version|chunkIndex|totalChunks
 */
export function buildAad(params: AADParams): Uint8Array<ArrayBuffer> {
  const parts = [
    params.userId,
    params.bucketId,
    params.objectKey,
    params.version ?? CRYPTO_VERSION,
    params.chunkIndex ?? 0,
    params.totalChunks ?? 1,
  ];
  return new TextEncoder().encode(parts.join("|"));
}

export async function encryptFile(
  file: File,
  publicKey: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
): Promise<EncryptedFileResult> {
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const plaintext = await file.arrayBuffer();
  
  // Enforce AAD binding
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    dek,
    plaintext
  );

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
  aad: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<Blob> {
  const wrappedDEKBytes = fromB64(encryptedDEK);
  const rawDEK = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrappedDEKBytes);

  const dek = await crypto.subtle.importKey(
    "raw", rawDEK, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );

  const ivBytes = fromB64(iv) as Uint8Array<ArrayBuffer>;
  
  // Decryption will fail if AAD doesn't match
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes, additionalData: aad },
    dek,
    ciphertext
  );
  
  return new Blob([plaintext], { type: contentType });
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
  aadBase: Omit<AADParams, "chunkIndex" | "totalChunks">,
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
      const chunkAad = buildAad({ ...aadBase, chunkIndex: i, totalChunks: chunkCount });
      
      const cipherChunk = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: chunkAad },
        dek,
        slice
      );
      
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

export async function decryptFileChunkedCombined(
  ciphertext: ArrayBuffer,
  encryptedDEK: string,
  chunkIvsStr: string | string[],
  chunkSize: number,
  chunkCount: number,
  privateKey: CryptoKey,
  aadBase: Omit<AADParams, "chunkIndex" | "totalChunks">,
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
    
    const chunkAad = buildAad({ ...aadBase, chunkIndex: i, totalChunks: chunkCount });
    decryptedChunks.push(await decryptChunk(slice, dek, chunkIvs[i], chunkAad));
  }

  return new Blob(decryptedChunks, { type: contentType });
}

export async function decryptChunk(
  cipherChunk: ArrayBuffer,
  dek: CryptoKey,
  ivB64: string,
  aad: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const iv = fromB64(ivB64) as Uint8Array<ArrayBuffer>;
  return crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, dek, cipherChunk);
}

/**
 * Encrypts metadata (e.g. filename) using the shared metadataKey.
 * Returns a versioned B64 envelope: [version][iv][ciphertext][tag]
 */
export async function encryptMetadataString(
  text: string,
  metadataKey: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    metadataKey,
    encoded,
  );

  const envelope: MetadataEnvelope = {
    version: CRYPTO_VERSION,
    iv,
    ciphertext: new Uint8Array(ciphertextBuffer),
  };

  return toB64(packEnvelope(envelope));
}

/**
 * Decrypts a versioned metadata envelope.
 * Handles backward compatibility for legacy formats.
 */
export async function decryptMetadataString(
  encryptedB64: string,
  metadataKey: CryptoKey | null,
  aad: Uint8Array<ArrayBuffer>,
): Promise<string> {
  try {
    const packed = fromB64(encryptedB64);

    // CRYPTO_VERSION check (0x02)
    if (packed[0] === CRYPTO_VERSION) {
      if (!metadataKey) throw new Error("Metadata key missing");
      const envelope = unpackEnvelope(packed);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: envelope.iv, additionalData: aad },
        metadataKey,
        envelope.ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    }

    // LEGACY READ-ONLY PATH (no AAD)
    if (packed.byteLength >= 44) {
      const nameKeyBytes = packed.slice(0, 32);
      const nameIV = packed.slice(32, 44);
      const ciphertext = packed.slice(44);
      
      const legacyKey = await crypto.subtle.importKey(
        "raw", nameKeyBytes, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
      );
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nameIV }, legacyKey, ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    }

    throw new Error("Unsupported metadata format");
  } catch (err) {
    console.warn("[E2EE] Authentication failed for metadata", err);
    throw err; // Fail closed
  }
}
