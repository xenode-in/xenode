import { describe, expect, it } from "vitest";
import type { CryptoEnvelope } from "@xenode/crypto-core";
import {
  isAccountEnvelope,
  isVaultEnvelope,
} from "../lib/vault-validation";

function envelope(type: CryptoEnvelope["type"]): CryptoEnvelope {
  return {
    accountId: "account-1",
    type,
    formatVersion: 2,
    algorithm: "AES-256-GCM",
    keyId: type === "device" ? "ark:device:test" : "ark",
    keyVersion: 1,
    ciphertext: "ciphertext-long-enough",
    iv: "iv-long-enough-value",
    aadVersion: 1,
    createdAt: new Date(0).toISOString(),
    status: "active",
  };
}

describe("Vault envelope validation", () => {
  it("accepts an account-bound device envelope", () => {
    expect(isVaultEnvelope(envelope("device"))).toBe(true);
    expect(
      isAccountEnvelope(envelope("device"), "account-1", "device"),
    ).toBe(true);
  });

  it("rejects cross-account and cross-purpose envelopes", () => {
    expect(
      isAccountEnvelope(envelope("device"), "account-2", "device"),
    ).toBe(false);
    expect(
      isAccountEnvelope(envelope("recovery"), "account-1", "password"),
    ).toBe(false);
  });
});
