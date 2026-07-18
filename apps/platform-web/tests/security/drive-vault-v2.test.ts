import { describe, expect, it } from "vitest";
import {
  decryptFile,
  decryptMetadataString,
  encryptFile,
  encryptMetadataString,
} from "@/lib/crypto/fileEncryption";
import { deriveDriveMetadataKey } from "@/lib/crypto/productKeys";

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
    const metadataKey = await deriveDriveMetadataKey(
      productSpaceKey,
      "personal:account_1",
    );
    const plaintext = new TextEncoder().encode("Drive Vault v2 round-trip");
    const encrypted = await encryptFile(
      new File([plaintext], "private.txt", { type: "text/plain" }),
      sharingKeys.publicKey,
    );
    const opened = await decryptFile(
      await encrypted.ciphertext.arrayBuffer(),
      encrypted.encryptedDEK,
      encrypted.iv!,
      sharingKeys.privateKey,
      "text/plain",
    );
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(plaintext);

    const encryptedName = await encryptMetadataString("private.txt", metadataKey);
    expect(await decryptMetadataString(encryptedName, metadataKey)).toBe(
      "private.txt",
    );
    expect(encryptedName).not.toContain("private.txt");
    productSpaceKey.fill(0);
  });

  it("binds metadata derivation to the Space", async () => {
    const productSpaceKey = crypto.getRandomValues(new Uint8Array(32));
    const first = await deriveDriveMetadataKey(productSpaceKey, "personal:a");
    const wrongSpace = await deriveDriveMetadataKey(productSpaceKey, "personal:b");
    const ciphertext = await encryptMetadataString("space-bound", first);
    expect(await decryptMetadataString(ciphertext, wrongSpace)).toBe(
      "Encrypted File",
    );
    productSpaceKey.fill(0);
  });
});
