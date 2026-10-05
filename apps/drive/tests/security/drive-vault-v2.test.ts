import { describe, expect, it } from "vitest";
import {
  decryptFileContent,
  decryptMetadataString,
  encryptFileBlob,
  encryptMetadataString,
  unwrapUserFileKey,
} from "@/lib/crypto/fileEncryption";
import { deriveMetadataKey } from "@xenode/crypto-core";

describe("Drive Vault v2 crypto", () => {
  it("round-trips file content and HKDF-derived metadata without an ARK", async () => {
    const sharingKeys = (await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      false,
      ["encrypt", "decrypt"],
    )) as CryptoKeyPair;
    const productSpaceKey = crypto.getRandomValues(new Uint8Array(32));
    const metadataKey = await deriveMetadataKey(
      productSpaceKey,
      "drive",
      "personal:account_1",
    );
    const plaintext = new TextEncoder().encode("Drive Vault v2 round-trip");
    const fileId = "65f000000000000000000001";
    const encrypted = await encryptFileBlob(
      new File([plaintext], "private.txt", { type: "text/plain" }),
      fileId,
      { wrappedBy: "user", publicKey: sharingKeys.publicKey },
    );
    const fileKey = await unwrapUserFileKey(encrypted.encryptedDEK, sharingKeys.privateKey, fileId);
    const opened = await decryptFileContent(
      await encrypted.ciphertext.arrayBuffer(),
      fileKey,
      { iv: encrypted.iv },
      fileId,
      "text/plain",
    );
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(plaintext);

    const binding = { fileId, purpose: "name" as const };
    const encryptedName = await encryptMetadataString("private.txt", metadataKey, binding);
    expect(await decryptMetadataString(encryptedName, metadataKey, binding)).toBe(
      "private.txt",
    );
    expect(encryptedName).not.toContain("private.txt");
    productSpaceKey.fill(0);
  });

  it("binds metadata derivation to the Space", async () => {
    const productSpaceKey = crypto.getRandomValues(new Uint8Array(32));
    const first = await deriveMetadataKey(productSpaceKey, "drive", "personal:a");
    const wrongSpace = await deriveMetadataKey(productSpaceKey, "drive", "personal:b");
    const binding = { fileId: "65f000000000000000000002", purpose: "name" as const };
    const ciphertext = await encryptMetadataString("space-bound", first, binding);
    expect(await decryptMetadataString(ciphertext, wrongSpace, binding)).toBe(
      "Encrypted File",
    );
    productSpaceKey.fill(0);
  });
});
