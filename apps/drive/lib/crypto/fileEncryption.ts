/**
 * lib/crypto/fileEncryption.ts
 *
 * Drive file content uses the authenticated `xenode-file/1` format from
 * `@xenode/crypto-core`: every sealed chunk and every wrap of a file key is
 * bound to the object's stable id, so a server cannot move, reorder or drop
 * them. A single-blob object is chunk 0 of 1; a multipart object stores one
 * sealed chunk per part.
 */

import {
  decryptFileChunk,
  decryptFileChunks,
  encryptFileChunks,
  generateFileKey,
  sealFileChunk,
  unwrapFileKey,
  unwrapFileKeyForShare,
  unwrapFileKeyForUser,
  wrapFileKey,
  wrapFileKeyForShare,
  wrapFileKeyForUser,
} from "@xenode/crypto-core";
import { toB64, fromB64 } from "./utils";

/** Where a new file key is wrapped: the account key (personal) or a Space key version. */
export type FileKeyTarget =
  | { wrappedBy: "user"; publicKey: CryptoKey }
  | { wrappedBy: "space"; rawSpaceKey: Uint8Array; spaceId: string; spaceKeyVersion: number };

export interface WrappedFileKey {
  encryptedDEK: string;
  spaceKeyWrapIv?: string;
}

/** How a stored object lays out its sealed content. */
export interface FileContentLayout {
  iv?: string | null;
  chunkIvs?: string | string[] | null;
  chunkSize?: number | null;
}

function importSpaceKey(rawSpaceKey: Uint8Array, usage: "wrapKey" | "unwrapKey"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawSpaceKey.slice() as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

async function wrapNewFileKey(
  fileKey: CryptoKey,
  target: FileKeyTarget,
  fileId: string,
): Promise<WrappedFileKey> {
  if (target.wrappedBy === "user") {
    return { encryptedDEK: toB64(await wrapFileKeyForUser(fileKey, target.publicKey, { fileId })) };
  }
  const wrapped = await wrapFileKey(fileKey, await importSpaceKey(target.rawSpaceKey, "wrapKey"), {
    fileId,
    spaceId: target.spaceId,
    spaceKeyVersion: target.spaceKeyVersion,
  });
  return { encryptedDEK: toB64(wrapped.wrappedKey), spaceKeyWrapIv: toB64(wrapped.iv) };
}

/** Seals a whole file as one blob (chunk 0 of 1) under a new file key. */
export async function encryptFileBlob(
  file: Blob,
  fileId: string,
  target: FileKeyTarget,
): Promise<WrappedFileKey & { ciphertext: Blob; iv: string }> {
  const fileKey = await generateFileKey();
  const sealed = await sealFileChunk(await file.arrayBuffer(), fileKey, { fileId }, 0, 1);
  return {
    ciphertext: new Blob([sealed.ciphertext], { type: "application/octet-stream" }),
    iv: toB64(sealed.iv),
    ...(await wrapNewFileKey(fileKey, target, fileId)),
  };
}

/** Seals a file as one chunk per multipart part under a new file key. */
export async function encryptFileParts(
  file: Blob,
  fileId: string,
  chunkSize: number,
  target: FileKeyTarget,
): Promise<WrappedFileKey & { parts: ArrayBuffer[]; chunkIvs: string[] }> {
  const fileKey = await generateFileKey();
  const sealed = await encryptFileChunks(await file.arrayBuffer(), fileKey, { fileId }, chunkSize);
  return {
    parts: sealed.chunks,
    chunkIvs: sealed.ivs.map(toB64),
    ...(await wrapNewFileKey(fileKey, target, fileId)),
  };
}

/** Seals a new revision of a file under its existing key (fresh IV). */
export async function encryptFileRevision(
  plaintext: ArrayBuffer,
  fileKey: CryptoKey,
  fileId: string,
): Promise<{ ciphertext: ArrayBuffer; iv: string }> {
  const sealed = await sealFileChunk(plaintext, fileKey, { fileId }, 0, 1);
  return { ciphertext: sealed.ciphertext, iv: toB64(sealed.iv) };
}

/** `extractable` only for callers that re-wrap the key for a share. */
export function unwrapUserFileKey(
  encryptedDEK: string,
  privateKey: CryptoKey,
  fileId: string,
  extractable = false,
): Promise<CryptoKey> {
  return unwrapFileKeyForUser(fromB64(encryptedDEK), privateKey, { fileId }, extractable);
}

export async function unwrapSpaceFileKey(
  encryptedDEK: string,
  spaceKeyWrapIv: string,
  rawSpaceKey: Uint8Array,
  context: { fileId: string; spaceId: string; spaceKeyVersion: number },
  extractable = false,
): Promise<CryptoKey> {
  return unwrapFileKey(
    fromB64(encryptedDEK),
    fromB64(spaceKeyWrapIv),
    await importSpaceKey(rawSpaceKey, "unwrapKey"),
    context,
    extractable,
  );
}

/** A stored object's file key wrap, as `/api/objects/[id]` returns it. */
export interface StoredFileKey {
  encryptedDEK?: string | null;
  wrappedBy?: "user" | "space" | null;
  spaceKeyWrapIv?: string | null;
  spaceKeyVersion?: number | null;
  spaceId?: string | null;
}

/**
 * Unwraps an object's file key from whichever key wraps it: the account key
 * (personal) or the Space key version the record was created with.
 */
export async function unwrapStoredFileKey(
  record: StoredFileKey,
  fileId: string,
  keys: {
    privateKey?: CryptoKey | null;
    rawSpaceKeyFor?: (version: number | null | undefined) => Promise<Uint8Array | null>;
  },
  extractable = false,
): Promise<CryptoKey> {
  if (!record.encryptedDEK) throw new Error("No encrypted key found for this file");
  if (record.wrappedBy === "space") {
    const rawKey = await keys.rawSpaceKeyFor?.(record.spaceKeyVersion);
    if (!rawKey || !record.spaceKeyWrapIv || !record.spaceKeyVersion || !record.spaceId) {
      throw new Error("Workspace key unavailable");
    }
    return unwrapSpaceFileKey(
      record.encryptedDEK,
      record.spaceKeyWrapIv,
      rawKey,
      { fileId, spaceId: String(record.spaceId), spaceKeyVersion: record.spaceKeyVersion },
      extractable,
    );
  }
  if (!keys.privateKey) throw new Error("Vault locked");
  return unwrapUserFileKey(record.encryptedDEK, keys.privateKey, fileId, extractable);
}

/** A share key wraps each shared file's key bound to that file. */
export async function wrapShareFileKey(
  fileKey: CryptoKey,
  shareKey: CryptoKey,
  fileId: string,
): Promise<{ shareEncryptedDEK: string; shareKeyIv: string }> {
  const wrapped = await wrapFileKeyForShare(fileKey, shareKey, { fileId });
  return { shareEncryptedDEK: toB64(wrapped.wrappedKey), shareKeyIv: toB64(wrapped.iv) };
}

export function unwrapShareFileKey(
  shareEncryptedDEK: string,
  shareKeyIv: string,
  shareKey: CryptoKey,
  fileId: string,
  extractable = false,
): Promise<CryptoKey> {
  return unwrapFileKeyForShare(
    fromB64(shareEncryptedDEK),
    fromB64(shareKeyIv),
    shareKey,
    { fileId },
    extractable,
  );
}

export function parseChunkIvs(chunkIvs: string | string[]): string[] {
  const ivs: unknown = typeof chunkIvs === "string" ? JSON.parse(chunkIvs) : chunkIvs;
  if (!Array.isArray(ivs) || !ivs.every((iv) => typeof iv === "string")) {
    throw new Error("Invalid file chunk IVs");
  }
  return ivs;
}

/** Decrypts a stored object's whole content (one blob, or its parts concatenated). */
export async function decryptFileContent(
  ciphertext: ArrayBuffer,
  fileKey: CryptoKey,
  layout: FileContentLayout,
  fileId: string,
  contentType: string,
): Promise<Blob> {
  if (layout.chunkIvs) {
    if (!layout.chunkSize) throw new Error("Chunked file has no chunk size");
    const plaintext = await decryptFileChunks(
      ciphertext,
      fileKey,
      parseChunkIvs(layout.chunkIvs).map(fromB64),
      { fileId },
      layout.chunkSize,
    );
    return new Blob(plaintext, { type: contentType });
  }
  if (!layout.iv) throw new Error("File has no IV");
  const plaintext = await decryptFileChunk(ciphertext, fileKey, fromB64(layout.iv), { fileId }, 0, 1);
  return new Blob([plaintext], { type: contentType });
}

/** Decrypts one part of a multipart object (`count` = the object's chunk count). */
export function decryptFilePart(
  sealedPart: ArrayBuffer,
  fileKey: CryptoKey,
  ivB64: string,
  fileId: string,
  index: number,
  count: number,
): Promise<ArrayBuffer> {
  return decryptFileChunk(sealedPart, fileKey, fromB64(ivB64), { fileId }, index, count);
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
    { name: "AES-GCM", iv },
    metadataKey,
    encoded,
  );

  // 0x02 = new metadataKey format. Distinguishes from legacy format unambiguously.
  const combined = new Uint8Array(1 + iv.length + ciphertextBuffer.byteLength);
  combined[0] = 0x02;
  combined.set(iv, 1);
  combined.set(new Uint8Array(ciphertextBuffer), 1 + iv.length);
  return toB64(combined);
}

/**
 * Decrypts a metadata string: [0x02] + [12 bytes IV] + [ciphertext] under the
 * metadata key. Any other value (including the retired format that carried
 * its own AES key, i.e. plaintext) is rejected.
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
        { name: "AES-GCM", iv },
        metadataKey,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    }

    return "Encrypted File";
  } catch (err) {
    console.warn("[E2EE] Failed to decrypt metadata string", err);
    return "Encrypted File";
  }
}

export async function encryptMetadataObject(
  metadata: Record<string, any>,
  metadataKey: CryptoKey,
): Promise<string> {
  const json = JSON.stringify(metadata);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(json);

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    metadataKey,
    encoded,
  );

  // 0x03 = standardized FileMetadata object
  const combined = new Uint8Array(1 + iv.length + cipher.byteLength);
  combined[0] = 0x03;
  combined.set(iv, 1);
  combined.set(new Uint8Array(cipher), 1 + iv.length);

  return toB64(combined);
}

export async function decryptMetadataObject(
  encryptedB64: string,
  metadataKey: CryptoKey,
): Promise<any> {
  const combined = fromB64(encryptedB64);

  // Supports both 0x02 (experimental) and 0x03 (standardized)
  if (combined[0] !== 0x02 && combined[0] !== 0x03) {
    throw new Error("Invalid metadata version: " + combined[0]);
  }

  const iv = combined.slice(1, 13);
  const cipher = combined.slice(13);

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    metadataKey,
    cipher,
  );

  return JSON.parse(new TextDecoder().decode(plain));
}
