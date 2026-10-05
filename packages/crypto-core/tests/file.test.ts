import { describe, expect, it } from "vitest";
import {
  decryptFileChunk,
  decryptFileChunks,
  encryptFileChunks,
  fileChunkCiphertextSizes,
  fileChunkCount,
  fileChunkRange,
  fileCiphertextBytes,
  generateFileKey,
  sealFileChunk,
  unwrapFileKey,
  unwrapFileKeyForShare,
  unwrapFileKeyForUser,
  wrapFileKey,
  wrapFileKeyForShare,
  wrapFileKeyForUser,
  type FileContext,
} from "../src";

const CHUNK = 64;
const file: FileContext = { fileId: "65f0aaaaaaaaaaaaaaaaaaaa" };
const other: FileContext = { fileId: "65f0bbbbbbbbbbbbbbbbbbbb" };

function bytes(length: number): ArrayBuffer {
  return Uint8Array.from({ length }, (_, index) => index % 251).buffer;
}

function join(parts: ArrayBuffer[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

async function sealed(length: number, context = file) {
  const key = await generateFileKey();
  const encrypted = await encryptFileChunks(bytes(length), key, context, CHUNK);
  return { key, ...encrypted, ciphertext: join(encrypted.chunks) };
}

async function opened(promise: Promise<ArrayBuffer[]>) {
  return new Uint8Array(join(await promise));
}

const aesKey = (usages: KeyUsage[]) =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, usages);

describe("authenticated file chunks", () => {
  it("round-trips and sizes ciphertext as plaintext plus one tag per chunk", async () => {
    const { key, ivs, chunks, ciphertext } = await sealed(150);
    expect(ivs).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual(fileChunkCiphertextSizes(150, CHUNK));
    expect(ciphertext.byteLength).toBe(fileCiphertextBytes(150, CHUNK));
    expect(await opened(decryptFileChunks(ciphertext, key, ivs, file, CHUNK)))
      .toEqual(new Uint8Array(bytes(150)));
  });

  it("gives an empty file one authenticated chunk", async () => {
    expect(fileChunkCount(0, CHUNK)).toBe(1);
    expect(fileChunkCiphertextSizes(0, CHUNK)).toEqual([16]);
    const { key, ivs, ciphertext } = await sealed(0);
    expect(ciphertext.byteLength).toBe(16);
    expect(await opened(decryptFileChunks(ciphertext, key, ivs, file, CHUNK))).toHaveLength(0);
    await expect(decryptFileChunks(new ArrayBuffer(0), key, [], file, CHUNK)).rejects.toThrow();
  });

  it("rejects reordered chunks even with their IVs", async () => {
    const { key, ivs, chunks } = await sealed(128);
    await expect(
      decryptFileChunks(join([chunks[1], chunks[0]]), key, [ivs[1], ivs[0]], file, CHUNK),
    ).rejects.toThrow();
  });

  it("rejects truncation and appended chunks", async () => {
    const { key, ivs, chunks } = await sealed(150);
    await expect(
      decryptFileChunks(join(chunks.slice(0, 2)), key, ivs.slice(0, 2), file, CHUNK),
    ).rejects.toThrow();
    const extra = await sealFileChunk(bytes(10), key, file, 3, 4);
    await expect(
      decryptFileChunks(join([...chunks, extra.ciphertext]), key, [...ivs, extra.iv], file, CHUNK),
    ).rejects.toThrow();
  });

  it("binds every chunk to its file", async () => {
    const { key, ivs, ciphertext, chunks } = await sealed(100);
    await expect(decryptFileChunks(ciphertext, key, ivs, other, CHUNK)).rejects.toThrow();
    // A chunk opens only at its own position within the right count.
    await expect(decryptFileChunk(chunks[0], key, ivs[0], file, 0, 1)).rejects.toThrow();
    expect(new Uint8Array(await decryptFileChunk(chunks[1], key, ivs[1], file, 1, 2)))
      .toEqual(new Uint8Array(bytes(100).slice(64)));
  });

  it("seals a single-blob file as chunk 0 of 1", async () => {
    const key = await generateFileKey();
    const blob = await sealFileChunk(bytes(40), key, file, 0, 1);
    expect(new Uint8Array(await decryptFileChunk(blob.ciphertext, key, blob.iv, file, 0, 1)))
      .toEqual(new Uint8Array(bytes(40)));
    await expect(decryptFileChunk(blob.ciphertext, key, blob.iv, other, 0, 1)).rejects.toThrow();
    await expect(decryptFileChunk(blob.ciphertext, key, blob.iv, file, 0, 2)).rejects.toThrow();
  });

  it("checks the chunk layout before decrypting", () => {
    expect(fileChunkRange(150 + 48, 2, 3, CHUNK)).toEqual({ start: 160, end: 198 });
    expect(() => fileChunkRange(150 + 48, 3, 3, CHUNK)).toThrow();
    expect(() => fileChunkRange(2 * (CHUNK + 16) + 15, 0, 3, CHUNK)).toThrow();
    expect(() => fileChunkRange(4 * (CHUNK + 16), 0, 3, CHUNK)).toThrow();
  });

  it("refuses ambiguous context fields", async () => {
    const key = await generateFileKey();
    await expect(encryptFileChunks(bytes(1), key, { fileId: "a\u001fb" }, CHUNK))
      .rejects.toThrow("Invalid file context");
    await expect(encryptFileChunks(bytes(1), key, { fileId: "" }, CHUNK))
      .rejects.toThrow("Invalid file context");
  });
});

describe("file key wraps", () => {
  it("unwraps a Space wrap only for the same Space, key version and file", async () => {
    const spaceKey = await aesKey(["wrapKey", "unwrapKey"]);
    const { key, ivs, ciphertext } = await sealed(10);
    const context = { ...file, spaceId: "space_a", spaceKeyVersion: 2 };
    const wrapped = await wrapFileKey(key, spaceKey, context);

    const unwrapped = await unwrapFileKey(wrapped.wrappedKey, wrapped.iv, spaceKey, context);
    expect(unwrapped.extractable).toBe(false);
    expect(await opened(decryptFileChunks(ciphertext, unwrapped, ivs, file, CHUNK)))
      .toEqual(new Uint8Array(bytes(10)));

    for (const moved of [
      { ...context, fileId: other.fileId },
      { ...context, spaceId: "space_b" },
      { ...context, spaceKeyVersion: 1 },
    ]) {
      await expect(unwrapFileKey(wrapped.wrappedKey, wrapped.iv, spaceKey, moved)).rejects.toThrow();
    }
    await expect(wrapFileKey(key, spaceKey, { ...context, spaceKeyVersion: 0 }))
      .rejects.toThrow("Invalid Space key version");
  });

  it("binds share and account wraps to the file", async () => {
    const key = await generateFileKey();
    const shareKey = await aesKey(["wrapKey", "unwrapKey"]);
    const shared = await wrapFileKeyForShare(key, shareKey, file);
    const reopened = await unwrapFileKeyForShare(shared.wrappedKey, shared.iv, shareKey, file, true);
    expect(reopened.extractable).toBe(true);
    await expect(unwrapFileKeyForShare(shared.wrappedKey, shared.iv, shareKey, other)).rejects.toThrow();

    const account = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      false,
      ["encrypt", "decrypt"],
    );
    const forUser = await wrapFileKeyForUser(key, account.publicKey, file);
    const mine = await unwrapFileKeyForUser(forUser, account.privateKey, file);
    const blob = await sealFileChunk(bytes(5), key, file, 0, 1);
    expect(new Uint8Array(await decryptFileChunk(blob.ciphertext, mine, blob.iv, file, 0, 1)))
      .toEqual(new Uint8Array(bytes(5)));
    await expect(unwrapFileKeyForUser(forUser, account.privateKey, other)).rejects.toThrow();
  });
});
