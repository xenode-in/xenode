import { File } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  decryptFile as decryptWebFile,
  decryptFileChunkedCombined as decryptWebChunked,
  decryptMetadataString as decryptWebMetadata,
  encryptFile as encryptWebFile,
  encryptFileChunked as encryptWebChunked,
  encryptMetadataString as encryptWebMetadata,
} from "@/lib/crypto/fileEncryption";
import {
  decryptFile as decryptMobileFile,
  decryptFileChunkedCombined as decryptMobileChunked,
  decryptMetadataString as decryptMobileMetadata,
  encryptFile as encryptMobileFile,
  encryptFileChunked as encryptMobileChunked,
  encryptMetadataString as encryptMobileMetadata,
} from "../../../xenode-expo/src/lib/crypto/fileEncryption";
import { deriveKey as deriveWebKey } from "@/lib/crypto/utils";
import { deriveKey as deriveMobileKey } from "../../../xenode-expo/src/lib/crypto/utils";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: ArrayBuffer) => new TextDecoder().decode(value);

async function keyPair() {
  return crypto.subtle.generateKey(RSA_PARAMS, true, ["encrypt", "decrypt"]);
}

describe("Web and Android E2EE compatibility", () => {
  it("decrypts Android single-blob files on Web", async () => {
    const keys = await keyPair();
    const encrypted = await encryptMobileFile(
      bytes("android-created").buffer,
      keys.publicKey,
    );

    const decrypted = await decryptWebFile(
      encrypted.ciphertext,
      encrypted.encryptedDEK,
      encrypted.iv,
      keys.privateKey,
      "text/plain",
    );

    expect(await decrypted.text()).toBe("android-created");
  });

  it("decrypts Web single-blob files on Android", async () => {
    const keys = await keyPair();
    const encrypted = await encryptWebFile(
      new File([bytes("web-created")], "fixture.txt", {
        type: "text/plain",
      }) as unknown as globalThis.File,
      keys.publicKey,
    );

    const decrypted = await decryptMobileFile(
      await encrypted.ciphertext.arrayBuffer(),
      encrypted.encryptedDEK,
      encrypted.iv,
      keys.privateKey,
      "text/plain",
    );

    expect(text(decrypted)).toBe("web-created");
  });

  it("decrypts chunked files in both directions", async () => {
    const keys = await keyPair();
    const payload = bytes("chunk-compatible-".repeat(128));

    const mobileEncrypted = await encryptMobileChunked(
      payload.buffer,
      keys.publicKey,
      128,
    );
    const webDecrypted = await decryptWebChunked(
      mobileEncrypted.ciphertext,
      mobileEncrypted.encryptedDEK,
      mobileEncrypted.chunkIvs,
      mobileEncrypted.chunkSize,
      mobileEncrypted.chunkCount,
      keys.privateKey,
      "text/plain",
    );
    expect(await webDecrypted.text()).toBe(text(payload.buffer));

    const webEncrypted = await encryptWebChunked(
      new File([payload], "chunked.txt", {
        type: "text/plain",
      }) as unknown as globalThis.File,
      keys.publicKey,
      128,
    );
    const mobileDecrypted = await decryptMobileChunked(
      await webEncrypted.ciphertext.arrayBuffer(),
      webEncrypted.encryptedDEK,
      JSON.stringify(webEncrypted.chunkIvs),
      webEncrypted.chunkSize,
      webEncrypted.chunkCount,
      keys.privateKey,
      "text/plain",
    );
    expect(text(mobileDecrypted)).toBe(text(payload.buffer));
  });

  it("decrypts filename and content-type metadata in both directions", async () => {
    const metadataKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const mobileName = await encryptMobileMetadata("photo.jpg", metadataKey);
    expect(await decryptWebMetadata(mobileName, metadataKey)).toBe("photo.jpg");

    const webType = await encryptWebMetadata("image/jpeg", metadataKey);
    expect(await decryptMobileMetadata(webType, metadataKey)).toBe("image/jpeg");
  });

  it("derives compatible vault and recovery wrapping keys", async () => {
    const privateKeyFixture = crypto.getRandomValues(new Uint8Array(256));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const passphrase = "master-password:recovery words";

    const webVaultKey = await deriveWebKey(passphrase, salt);
    const mobileVaultKey = await deriveMobileKey(passphrase, salt);
    const encryptedVault = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      webVaultKey,
      privateKeyFixture,
    );
    const mobileVault = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      mobileVaultKey,
      encryptedVault,
    );
    expect(new Uint8Array(mobileVault)).toEqual(privateKeyFixture);

    const recoveryWords = "one two three four five six";
    const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
    const recoveryIv = crypto.getRandomValues(new Uint8Array(12));
    const mobileRecoveryKey = await deriveMobileKey(recoveryWords, recoverySalt);
    const webRecoveryKey = await deriveWebKey(recoveryWords, recoverySalt);
    const recoveryEnvelope = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: recoveryIv },
      mobileRecoveryKey,
      privateKeyFixture,
    );
    const webRecovered = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: recoveryIv },
      webRecoveryKey,
      recoveryEnvelope,
    );
    expect(new Uint8Array(webRecovered)).toEqual(privateKeyFixture);
  });
});
