import { describe, expect, it } from "vitest";
import {
  derivePurposeKey,
  generateAccountRootKey,
  generateMetadataKey,
  openEnvelope,
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
});
