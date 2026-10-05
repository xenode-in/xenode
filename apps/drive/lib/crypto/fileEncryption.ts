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
  openFileMetadata,
  sealFileChunk,
  sealFileMetadata,
  type FileMetadataPurpose,
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

/** What a metadata value is bound to: its object and its purpose. */
export interface MetadataBinding {
  fileId: string;
  purpose: FileMetadataPurpose;
}

/** Bound metadata values are base64 of [0x04][12-byte IV][AES-GCM ciphertext]. */
const METADATA_FORMAT = 0x04;
const METADATA_IV_BYTES = 12;

async function sealString(text: string, key: CryptoKey, binding: MetadataBinding): Promise<string> {
  const sealed = await sealFileMetadata(new TextEncoder().encode(text), key, binding);
  const combined = new Uint8Array(1 + METADATA_IV_BYTES + sealed.ciphertext.byteLength);
  combined[0] = METADATA_FORMAT;
  combined.set(sealed.iv, 1);
  combined.set(new Uint8Array(sealed.ciphertext), 1 + METADATA_IV_BYTES);
  return toB64(combined);
}

async function openString(value: string, key: CryptoKey, binding: MetadataBinding): Promise<string> {
  const combined = fromB64(value);
  if (combined[0] !== METADATA_FORMAT || combined.length < 1 + METADATA_IV_BYTES + 16) {
    throw new Error("Unsupported metadata format");
  }
  const plaintext = await openFileMetadata(
    combined.slice(1 + METADATA_IV_BYTES),
    combined.slice(1, 1 + METADATA_IV_BYTES),
    key,
    binding,
  );
  return new TextDecoder().decode(plaintext);
}

/** Seals a name, content type or tag list under the Space metadata key. */
export function encryptMetadataString(
  text: string,
  metadataKey: CryptoKey,
  binding: MetadataBinding,
): Promise<string> {
  return sealString(text, metadataKey, binding);
}

/**
 * Opens a bound metadata string. A missing key, another file's value, another
 * purpose or any other format yields the "Encrypted File" sentinel.
 */
export async function decryptMetadataString(
  value: string,
  metadataKey: CryptoKey | null,
  binding: MetadataBinding,
): Promise<string> {
  if (!metadataKey) return "Encrypted File";
  try {
    return await openString(value, metadataKey, binding);
  } catch (err) {
    console.warn("[E2EE] Failed to decrypt metadata string", err);
    return "Encrypted File";
  }
}

export function encryptMetadataObject(
  metadata: object,
  metadataKey: CryptoKey,
  fileId: string,
): Promise<string> {
  return sealString(JSON.stringify(metadata), metadataKey, { fileId, purpose: "metadata" });
}

export async function decryptMetadataObject(
  value: string,
  metadataKey: CryptoKey,
  fileId: string,
): Promise<unknown> {
  return JSON.parse(await openString(value, metadataKey, { fileId, purpose: "metadata" }));
}

/** Seals a thumbnail data URL; the upload stores it as the `-thumb` sidecar. */
export function encryptThumbnail(dataUrl: string, metadataKey: CryptoKey, fileId: string): Promise<string> {
  return sealString(dataUrl, metadataKey, { fileId, purpose: "thumbnail" });
}

/** Opens a bound thumbnail; anything else, including plaintext, yields "". */
export async function decryptThumbnail(value: string, key: CryptoKey, fileId: string): Promise<string> {
  try {
    const dataUrl = await openString(value, key, { fileId, purpose: "thumbnail" });
    return dataUrl.startsWith("data:image/") ? dataUrl : "";
  } catch {
    return "";
  }
}

/**
 * Seals a value under a share key (or, for comments, the file key), bound like
 * metadata. Share pages have no vault, so names and types are re-sealed for them.
 */
export function encryptWithShareKey(
  text: string,
  shareKey: CryptoKey,
  binding: MetadataBinding,
): Promise<string> {
  return sealString(text, shareKey, binding);
}

export function decryptWithShareKey(
  value: string,
  shareKey: CryptoKey,
  binding: MetadataBinding,
): Promise<string> {
  return openString(value, shareKey, binding);
}
