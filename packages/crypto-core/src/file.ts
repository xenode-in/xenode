import { utf8 } from "./encoding";

/**
 * Authenticated file content format, version 1.
 *
 * Content is a sequence of sealed chunks under the file's own random key, each
 * with a random 96-bit IV. Every chunk's AAD binds the file (its stable object
 * id), the chunk index and the chunk count, so a server cannot reorder, drop,
 * append or move chunks between files. A file always has at least one chunk,
 * so even an empty file is authenticated. Every wrap of the file key binds the
 * file too (and, under a Space key, the Space and key version), so a wrapped
 * key cannot be attached to another file. Revisions of a file reuse its key
 * with fresh IVs.
 */
export const FILE_FORMAT = "xenode-file/1";
export const FILE_CHUNK_BYTES = 1_048_576;
const TAG_BYTES = 16;
const IV_BYTES = 12;
const ENCRYPT_CONCURRENCY = 4;

/** The file a ciphertext belongs to: the object's stable id. */
export interface FileContext {
  fileId: string;
}

export interface SpaceFileKeyContext extends FileContext {
  spaceId: string;
  spaceKeyVersion: number;
}

export interface SealedFileChunk {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

export interface EncryptedFileChunks {
  chunks: ArrayBuffer[];
  ivs: Uint8Array[];
}

function additionalData(purpose: string, fields: readonly string[]): Uint8Array {
  for (const field of fields) {
    if (!field || field.includes("\u001f")) throw new Error("Invalid file context");
  }
  return utf8([FILE_FORMAT, purpose, ...fields].join("\u001f"));
}

/** Chunk AAD; exported so non-module readers (the media service worker) can be checked against it. */
export function fileChunkAdditionalData(context: FileContext, index: number, count: number): Uint8Array {
  if (
    !Number.isSafeInteger(count) || count < 1 ||
    !Number.isSafeInteger(index) || index < 0 || index >= count
  ) {
    throw new Error("Invalid file chunk position");
  }
  return additionalData("chunk", [context.fileId, String(index), String(count)]);
}

function spaceKeyData(context: SpaceFileKeyContext): BufferSource {
  if (!Number.isSafeInteger(context.spaceKeyVersion) || context.spaceKeyVersion < 1) {
    throw new Error("Invalid Space key version");
  }
  return additionalData("space-key", [
    context.spaceId,
    String(context.spaceKeyVersion),
    context.fileId,
  ]) as BufferSource;
}

const userKeyLabel = (context: FileContext) =>
  additionalData("user-key", [context.fileId]) as BufferSource;
const shareKeyData = (context: FileContext) =>
  additionalData("share-key", [context.fileId]) as BufferSource;

function checkChunkBytes(chunkBytes: number): void {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) {
    throw new Error("Invalid file chunk size");
  }
}

export function fileChunkCount(plaintextBytes: number, chunkBytes = FILE_CHUNK_BYTES): number {
  checkChunkBytes(chunkBytes);
  if (!Number.isSafeInteger(plaintextBytes) || plaintextBytes < 0) {
    throw new Error("Invalid file size");
  }
  return Math.max(1, Math.ceil(plaintextBytes / chunkBytes));
}

/** Sealed size of each chunk, in order: plaintext bytes plus one tag each. */
export function fileChunkCiphertextSizes(plaintextBytes: number, chunkBytes = FILE_CHUNK_BYTES): number[] {
  const count = fileChunkCount(plaintextBytes, chunkBytes);
  return Array.from({ length: count }, (_, index) =>
    Math.min(chunkBytes, plaintextBytes - index * chunkBytes) + TAG_BYTES);
}

export function fileCiphertextBytes(plaintextBytes: number, chunkBytes = FILE_CHUNK_BYTES): number {
  return plaintextBytes + TAG_BYTES * fileChunkCount(plaintextBytes, chunkBytes);
}

/** Byte range of chunk `index` inside the concatenated ciphertext. */
export function fileChunkRange(
  ciphertextBytes: number,
  index: number,
  count: number,
  chunkBytes = FILE_CHUNK_BYTES,
): { start: number; end: number } {
  checkChunkBytes(chunkBytes);
  const sealed = chunkBytes + TAG_BYTES;
  const lastBytes = ciphertextBytes - (count - 1) * sealed;
  if (
    !Number.isSafeInteger(count) || count < 1 ||
    !Number.isSafeInteger(index) || index < 0 || index >= count ||
    lastBytes < TAG_BYTES || lastBytes > sealed
  ) {
    throw new Error("File ciphertext does not match its chunk layout");
  }
  const start = index * sealed;
  return { start, end: index === count - 1 ? ciphertextBytes : start + sealed };
}

export async function sealFileChunk(
  plaintext: BufferSource,
  fileKey: CryptoKey,
  context: FileContext,
  index: number,
  count: number,
): Promise<SealedFileChunk> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: fileChunkAdditionalData(context, index, count) as BufferSource,
      tagLength: 128,
    },
    fileKey,
    plaintext,
  );
  return { ciphertext, iv };
}

export async function encryptFileChunks(
  plaintext: ArrayBuffer,
  fileKey: CryptoKey,
  context: FileContext,
  chunkBytes = FILE_CHUNK_BYTES,
): Promise<EncryptedFileChunks> {
  const count = fileChunkCount(plaintext.byteLength, chunkBytes);
  const chunks = new Array<ArrayBuffer>(count);
  const ivs = new Array<Uint8Array>(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next++;
      const sealed = await sealFileChunk(
        plaintext.slice(index * chunkBytes, Math.min((index + 1) * chunkBytes, plaintext.byteLength)),
        fileKey,
        context,
        index,
        count,
      );
      chunks[index] = sealed.ciphertext;
      ivs[index] = sealed.iv;
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENCRYPT_CONCURRENCY, count) }, worker));
  return { chunks, ivs };
}

export async function decryptFileChunk(
  sealedChunk: BufferSource,
  fileKey: CryptoKey,
  iv: Uint8Array,
  context: FileContext,
  index: number,
  count: number,
): Promise<ArrayBuffer> {
  if (iv.byteLength !== IV_BYTES) throw new Error("Invalid file chunk IV");
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: fileChunkAdditionalData(context, index, count) as BufferSource,
      tagLength: 128,
    },
    fileKey,
    sealedChunk,
  );
}

/** Decrypts every chunk in order; the IV list fixes the chunk count. */
export async function decryptFileChunks(
  ciphertext: ArrayBuffer,
  fileKey: CryptoKey,
  ivs: readonly Uint8Array[],
  context: FileContext,
  chunkBytes = FILE_CHUNK_BYTES,
): Promise<ArrayBuffer[]> {
  const count = ivs.length;
  if (count < 1) throw new Error("File ciphertext does not match its chunk layout");
  const plaintext: ArrayBuffer[] = [];
  for (let index = 0; index < count; index++) {
    const { start, end } = fileChunkRange(ciphertext.byteLength, index, count, chunkBytes);
    plaintext.push(
      await decryptFileChunk(ciphertext.slice(start, end), fileKey, ivs[index], context, index, count),
    );
  }
  return plaintext;
}

export function generateFileKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

const FILE_KEY_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const FILE_KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt"];

async function wrapUnderAesKey(
  fileKey: CryptoKey,
  wrappingKey: CryptoKey,
  aad: BufferSource,
): Promise<{ wrappedKey: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapped = await crypto.subtle.wrapKey("raw", fileKey, wrappingKey, {
    name: "AES-GCM",
    iv,
    additionalData: aad,
    tagLength: 128,
  });
  return { wrappedKey: new Uint8Array(wrapped), iv };
}

function unwrapUnderAesKey(
  wrappedKey: Uint8Array,
  iv: Uint8Array,
  wrappingKey: CryptoKey,
  aad: BufferSource,
  extractable: boolean,
): Promise<CryptoKey> {
  if (iv.byteLength !== IV_BYTES) throw new Error("Invalid file key IV");
  return crypto.subtle.unwrapKey(
    "raw",
    wrappedKey as BufferSource,
    wrappingKey,
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad, tagLength: 128 },
    FILE_KEY_ALGORITHM,
    extractable,
    FILE_KEY_USAGES,
  );
}

/** Wraps a file key under a Space key (`wrapKey`/`unwrapKey` usages). */
export async function wrapFileKey(fileKey: CryptoKey, spaceKey: CryptoKey, context: SpaceFileKeyContext) {
  return wrapUnderAesKey(fileKey, spaceKey, spaceKeyData(context));
}

/** `extractable` only for callers that re-wrap the key (sharing). */
export async function unwrapFileKey(
  wrappedKey: Uint8Array,
  iv: Uint8Array,
  spaceKey: CryptoKey,
  context: SpaceFileKeyContext,
  extractable = false,
): Promise<CryptoKey> {
  return unwrapUnderAesKey(wrappedKey, iv, spaceKey, spaceKeyData(context), extractable);
}

/** Wraps a file key under a share key (`wrapKey`/`unwrapKey` usages). */
export async function wrapFileKeyForShare(fileKey: CryptoKey, shareKey: CryptoKey, context: FileContext) {
  return wrapUnderAesKey(fileKey, shareKey, shareKeyData(context));
}

export async function unwrapFileKeyForShare(
  wrappedKey: Uint8Array,
  iv: Uint8Array,
  shareKey: CryptoKey,
  context: FileContext,
  extractable = false,
): Promise<CryptoKey> {
  return unwrapUnderAesKey(wrappedKey, iv, shareKey, shareKeyData(context), extractable);
}

/**
 * Wraps a file key to an account's RSA-OAEP public key (`encrypt` usage); the
 * OAEP label binds the file.
 */
export async function wrapFileKeyForUser(
  fileKey: CryptoKey,
  publicKey: CryptoKey,
  context: FileContext,
): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", fileKey));
  try {
    return new Uint8Array(
      await crypto.subtle.encrypt({ name: "RSA-OAEP", label: userKeyLabel(context) }, publicKey, raw),
    );
  } finally {
    raw.fill(0);
  }
}

/** Opens a user wrap with the account's RSA-OAEP private key (`decrypt` usage). */
export async function unwrapFileKeyForUser(
  wrappedKey: Uint8Array,
  privateKey: CryptoKey,
  context: FileContext,
  extractable = false,
): Promise<CryptoKey> {
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "RSA-OAEP", label: userKeyLabel(context) },
      privateKey,
      wrappedKey as BufferSource,
    ),
  );
  try {
    if (raw.byteLength !== 32) throw new Error("File keys must be 256 bits");
    return await crypto.subtle.importKey("raw", raw, FILE_KEY_ALGORITHM, extractable, FILE_KEY_USAGES);
  } finally {
    raw.fill(0);
  }
}
