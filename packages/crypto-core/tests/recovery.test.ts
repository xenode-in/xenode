import { describe, expect, it } from "vitest";
import {
  deriveRecoveryKeyFromMnemonic,
  generateRecoveryMnemonic,
  isValidRecoveryPhrase,
  openEnvelope,
  recoveryWords,
  sealEnvelope,
} from "../src/index";

describe("BIP39 recovery", () => {
  it("generates a 12-word phrase with a 256-bit derived key", async () => {
    const { words, secret } = await generateRecoveryMnemonic();
    expect(recoveryWords(words)).toHaveLength(12);
    expect(secret).toHaveLength(32);
    expect(isValidRecoveryPhrase(words)).toBe(true);
  });

  it("derives the same key deterministically from the same phrase", async () => {
    const { words, secret } = await generateRecoveryMnemonic();
    const again = await deriveRecoveryKeyFromMnemonic(words);
    expect(Array.from(again)).toEqual(Array.from(secret));
  });

  it("is tolerant of surrounding whitespace / casing", async () => {
    const { words, secret } = await generateRecoveryMnemonic();
    const messy = `  ${words.toUpperCase().replace(/ /gu, "   ")}  `;
    expect(isValidRecoveryPhrase(messy)).toBe(true);
    const again = await deriveRecoveryKeyFromMnemonic(messy);
    expect(Array.from(again)).toEqual(Array.from(secret));
  });

  it("rejects an invalid phrase (bad checksum / wrong words)", async () => {
    expect(isValidRecoveryPhrase("not a real bip39 phrase at all here now")).toBe(
      false,
    );
    await expect(
      deriveRecoveryKeyFromMnemonic("abandon abandon abandon"),
    ).rejects.toThrow(/invalid recovery phrase/iu);
  });

  it("round-trips: recovery key unwraps an ARK sealed under it", async () => {
    const { words, secret } = await generateRecoveryMnemonic();
    const ark = crypto.getRandomValues(new Uint8Array(32));
    const context = {
      accountId: "acct_test",
      keyId: "ark",
      keyVersion: 1,
      type: "recovery",
    } as const;
    const envelope = await sealEnvelope(ark, secret, context);
    // Simulate recovery on another device: derive the key from the words alone.
    const derived = await deriveRecoveryKeyFromMnemonic(words);
    const opened = await openEnvelope(envelope, derived, context);
    expect(Array.from(opened)).toEqual(Array.from(ark));
  });
});
