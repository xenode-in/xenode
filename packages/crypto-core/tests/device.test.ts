import { describe, expect, it } from "vitest";
import {
  derivePasskeyWrappingKey,
  encodeBase64Url,
  openEnvelopeWithKey,
  sealEnvelopeWithKey,
} from "../src";

describe("device wrapping", () => {
  it("derives a stable non-extractable passkey wrapping key", async () => {
    const output = new Uint8Array(32).fill(7);
    const salt = encodeBase64Url(new Uint8Array(32).fill(9));
    const first = await derivePasskeyWrappingKey(output, salt);
    const second = await derivePasskeyWrappingKey(output, salt);
    expect(first.extractable).toBe(false);

    const plaintext = new Uint8Array(32).fill(3);
    const context = {
      accountId: "account-1",
      keyId: "ark:passkey:credential",
      keyVersion: 1,
      type: "device" as const,
    };
    const envelope = await sealEnvelopeWithKey(plaintext, first, context);
    await expect(openEnvelopeWithKey(envelope, second, context)).resolves.toEqual(
      plaintext,
    );
  });
});
