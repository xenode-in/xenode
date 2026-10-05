import { describe, expect, it } from "vitest";
import {
  decryptFileContent,
  decryptFilePart,
  encryptFileBlob,
  encryptFileParts,
  encryptFileRevision,
  unwrapShareFileKey,
  unwrapStoredFileKey,
  wrapShareFileKey,
} from "@/lib/crypto/fileEncryption";

// A malicious metadata server can rearrange stored records, wraps and blobs,
// but it cannot make one file's ciphertext or key open as another file's.
const A = "65f0000000000000000000aa";
const B = "65f0000000000000000000bb";
const SPACE = "65f000000000000000000005";
const CHUNK = 2 * 1024 * 1024;

const bytes = (length: number, seed = 1) =>
  Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 251);

async function rsaPair() {
  return (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    false,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair;
}

const plain = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe("Drive file content binding", () => {
  it("opens a personal file only under its own object id", async () => {
    const keys = await rsaPair();
    const target = { wrappedBy: "user", publicKey: keys.publicKey } as const;
    const a = await encryptFileBlob(new Blob([bytes(300, 1)]), A, target);
    const b = await encryptFileBlob(new Blob([bytes(300, 2)]), B, target);
    const unlock = { privateKey: keys.privateKey };

    const keyA = await unwrapStoredFileKey(a, A, unlock);
    expect(await plain(await decryptFileContent(await a.ciphertext.arrayBuffer(), keyA, a, A, "x")))
      .toEqual(bytes(300, 1));

    // B's wrapped key attached to A's record, or A's record read as B.
    await expect(unwrapStoredFileKey(b, A, unlock)).rejects.toThrow();
    await expect(unwrapStoredFileKey(a, B, unlock)).rejects.toThrow();
    // B's ciphertext served for A, with A's key and A's IV or B's.
    const cipherB = await b.ciphertext.arrayBuffer();
    await expect(decryptFileContent(cipherB, keyA, a, A, "x")).rejects.toThrow();
    await expect(decryptFileContent(cipherB, keyA, b, A, "x")).rejects.toThrow();
  });

  it("binds a workspace wrap to the Space and key version", async () => {
    const rawSpaceKey = crypto.getRandomValues(new Uint8Array(32));
    const record = {
      ...(await encryptFileBlob(new Blob([bytes(64)]), A, {
        wrappedBy: "space", rawSpaceKey, spaceId: SPACE, spaceKeyVersion: 3,
      })),
      wrappedBy: "space" as const,
      spaceKeyVersion: 3,
      spaceId: SPACE,
    };
    const rawSpaceKeyFor = async () => rawSpaceKey;
    const key = await unwrapStoredFileKey(record, A, { rawSpaceKeyFor });
    expect(await plain(await decryptFileContent(await record.ciphertext.arrayBuffer(), key, record, A, "x")))
      .toEqual(bytes(64));

    for (const moved of [{ spaceKeyVersion: 2 }, { spaceId: "65f000000000000000000006" }]) {
      await expect(unwrapStoredFileKey({ ...record, ...moved }, A, { rawSpaceKeyFor })).rejects.toThrow();
    }
  });

  it("rejects reordered, truncated and transplanted multipart chunks", async () => {
    const keys = await rsaPair();
    const target = { wrappedBy: "user", publicKey: keys.publicKey } as const;
    const size = 2 * CHUNK + 1000;
    const a = await encryptFileParts(new Blob([bytes(size)]), A, CHUNK, target);
    const key = await unwrapStoredFileKey(a, A, { privateKey: keys.privateKey });
    const layout = { chunkIvs: a.chunkIvs, chunkSize: CHUNK };
    const whole = (parts: ArrayBuffer[]) => new Blob(parts).arrayBuffer();

    expect(await plain(await decryptFileContent(await whole(a.parts), key, layout, A, "x")))
      .toEqual(bytes(size));
    await expect(decryptFileContent(
      await whole([a.parts[1], a.parts[0], a.parts[2]]), key,
      { ...layout, chunkIvs: [a.chunkIvs[1], a.chunkIvs[0], a.chunkIvs[2]] }, A, "x",
    )).rejects.toThrow();
    await expect(decryptFileContent(
      await whole(a.parts.slice(0, 2)), key, { ...layout, chunkIvs: a.chunkIvs.slice(0, 2) }, A, "x",
    )).rejects.toThrow();
    // Streaming readers decrypt one part at a time; the count is part of it.
    await expect(decryptFilePart(a.parts[0], key, a.chunkIvs[0], A, 0, 2)).rejects.toThrow();
    await expect(decryptFilePart(a.parts[0], key, a.chunkIvs[0], B, 0, 3)).rejects.toThrow();
  });

  it("keeps revisions and share wraps bound to the same file", async () => {
    const keys = await rsaPair();
    const a = await encryptFileBlob(new Blob([bytes(10)]), A, { wrappedBy: "user", publicKey: keys.publicKey });
    const key = await unwrapStoredFileKey(a, A, { privateKey: keys.privateKey }, true);

    const revision = await encryptFileRevision(bytes(20, 9).slice().buffer, key, A);
    expect(await plain(await decryptFileContent(revision.ciphertext, key, revision, A, "x")))
      .toEqual(bytes(20, 9));
    await expect(decryptFileContent(revision.ciphertext, key, revision, B, "x")).rejects.toThrow();

    const shareKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
    const shared = await wrapShareFileKey(key, shareKey, A);
    const opened = await unwrapShareFileKey(shared.shareEncryptedDEK, shared.shareKeyIv, shareKey, A);
    expect(await plain(await decryptFileContent(await a.ciphertext.arrayBuffer(), opened, a, A, "x")))
      .toEqual(bytes(10));
    // A bundle's item key cannot be swapped onto another item.
    await expect(unwrapShareFileKey(shared.shareEncryptedDEK, shared.shareKeyIv, shareKey, B)).rejects.toThrow();
  });
});
