import { describe, expect, it } from "vitest";
import { decryptDocument, encryptDocument } from "@/lib/crypto/documentCrypto";

const IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}

describe("documentCrypto", () => {
  it("round-trips a document through encrypt → decrypt", async () => {
    const key = await makeKey();
    const plaintext = toBuffer("Hello, end-to-end encrypted document! 🔐");

    const encrypted = await encryptDocument(plaintext, key);
    const decrypted = await decryptDocument(encrypted, key);

    expect(buffersEqual(decrypted, plaintext)).toBe(true);
  });

  it("produces [iv(12) | ciphertext+tag]", async () => {
    const key = await makeKey();
    const plaintext = toBuffer("abc"); // 3 bytes

    const encrypted = await encryptDocument(plaintext, key);

    expect(encrypted.byteLength).toBe(3 + IV_LENGTH + GCM_TAG_LENGTH);
  });

  it("uses a fresh IV on every encrypt — IVs and ciphertext never repeat", async () => {
    const key = await makeKey();
    const plaintext = toBuffer("the same input encrypted twice");

    const a = new Uint8Array(await encryptDocument(plaintext, key));
    const b = new Uint8Array(await encryptDocument(plaintext, key));

    const ivA = a.slice(0, IV_LENGTH);
    const ivB = b.slice(0, IV_LENGTH);

    expect(buffersEqual(ivA.buffer, ivB.buffer)).toBe(false);
    expect(buffersEqual(a.buffer, b.buffer)).toBe(false);
  });

  it("throws on the wrong key (never returns partial content)", async () => {
    const correctKey = await makeKey();
    const wrongKey = await makeKey();
    const encrypted = await encryptDocument(toBuffer("secret"), correctKey);

    await expect(decryptDocument(encrypted, wrongKey)).rejects.toThrow(/decrypt/i);
  });

  it("throws on tampered ciphertext (GCM auth fails)", async () => {
    const key = await makeKey();
    const encrypted = await encryptDocument(toBuffer("integrity matters"), key);

    const tampered = new Uint8Array(encrypted);
    tampered[tampered.length - 1] ^= 0xff; // corrupt the auth tag

    await expect(decryptDocument(tampered.buffer, key)).rejects.toThrow();
  });

  it("throws on a blob too small to contain an IV", async () => {
    const key = await makeKey();
    await expect(
      decryptDocument(new Uint8Array(8).buffer, key),
    ).rejects.toThrow();
  });
});
