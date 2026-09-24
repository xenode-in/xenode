import { afterEach, describe, expect, it } from "vitest";
import {
  generateAccountRootKey,
  sealEnvelope,
  openEnvelopeWithKey,
} from "@xenode/crypto-core";
import {
  cacheAccountRootKey,
  clearCachedAccountRootKey,
  loadCachedAccountRootKey,
} from "../lib/ark-cache";

afterEach(async () => {
  await clearCachedAccountRootKey();
});

describe("Accounts root-key lifetime", () => {
  it("holds a usable key only in this module's memory and clears it on sign-out", async () => {
    const root = generateAccountRootKey();
    const context = {
      accountId: "account_1",
      keyId: "test",
      keyVersion: 1,
      type: "metadata-key" as const,
    };
    const envelope = await sealEnvelope(
      new Uint8Array([1, 2, 3]),
      root,
      context,
    );
    await cacheAccountRootKey("account_1", root);
    root.fill(0);
    const key = await loadCachedAccountRootKey("account_1");
    expect(key?.extractable).toBe(false);
    expect(await openEnvelopeWithKey(envelope, key!, context)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await clearCachedAccountRootKey();
    await expect(loadCachedAccountRootKey("account_1")).resolves.toBeNull();
  });

  it("drops the prior account's root key on account switch", async () => {
    await cacheAccountRootKey("old", generateAccountRootKey());
    await cacheAccountRootKey("new", generateAccountRootKey());
    await expect(loadCachedAccountRootKey("old")).resolves.toBeNull();
    await expect(loadCachedAccountRootKey("new")).resolves.not.toBeNull();
  });
});
