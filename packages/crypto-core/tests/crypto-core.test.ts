import { describe, expect, it } from "vitest";
import {
  derivePurposeKey,
  encodeBase64Url,
  generateAccountRootKey,
  generateMetadataKey,
  openEnvelope,
  openRsaOaepProductSpaceKey,
  sealEnvelope,
  type EnvelopeContext,
} from "../src";

const context: EnvelopeContext = {
  accountId: "acct_1",
  spaceId: "space_1",
  productId: "drive",
  keyId: "key_1",
  keyVersion: 1,
  type: "product-space-key",
};

describe("Vault v2 envelopes", () => {
  it("round-trips key material and rejects the wrong wrapping key", async () => {
    const ark = generateAccountRootKey();
    const material = generateMetadataKey();
    const envelope = await sealEnvelope(material, ark, context);

    expect(await openEnvelope(envelope, ark, context)).toEqual(material);
    await expect(
      openEnvelope(envelope, generateAccountRootKey(), context),
    ).rejects.toThrow();
  });

  it("fails closed when AAD identity or product context is substituted", async () => {
    const ark = generateAccountRootKey();
    const envelope = await sealEnvelope(generateMetadataKey(), ark, context);

    await expect(
      openEnvelope(envelope, ark, { ...context, accountId: "acct_2" }),
    ).rejects.toThrow("context");
    await expect(
      openEnvelope(envelope, ark, { ...context, productId: "photos" }),
    ).rejects.toThrow("context");
  });

  it("derives product and purpose isolated keys without exposing the root", async () => {
    const ark = generateAccountRootKey();
    const salt = new Uint8Array(32).fill(7);
    const drive = await derivePurposeKey(ark, "drive", "metadata", salt);
    const photos = await derivePurposeKey(ark, "photos", "metadata", salt);
    const driveAgain = await derivePurposeKey(ark, "drive", "metadata", salt);

    expect(drive).toEqual(driveAgain);
    expect(drive).not.toEqual(photos);
    expect(drive).not.toEqual(ark);
  });
  it("unwraps RSA organization product keys with the Vault sharing key", async () => {
    const sharingPair = (await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"],
    )) as CryptoKeyPair;
    const productSpaceKey = generateMetadataKey();
    const [privateKeyPkcs8, ciphertext] = await Promise.all([
      crypto.subtle.exportKey("pkcs8", sharingPair.privateKey),
      crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        sharingPair.publicKey,
        productSpaceKey as BufferSource,
      ),
    ]);

    expect(
      await openRsaOaepProductSpaceKey(
        encodeBase64Url(new Uint8Array(ciphertext)),
        new Uint8Array(privateKeyPkcs8),
      ),
    ).toEqual(productSpaceKey);
    await expect(
      openRsaOaepProductSpaceKey(
        encodeBase64Url(new Uint8Array(ciphertext)),
        new Uint8Array(32),
      ),
    ).rejects.toThrow();
  });
});
