import { describe, expect, it } from "vitest";
import { importProductKey } from "@xenode/crypto-core";
import { ProductKeyStore } from "../src/key-store";

describe("ProductKeyStore", () => {
  it("holds a non-extractable product key and runs operations with it", async () => {
    const store = new ProductKeyStore("photos");
    const key = await importProductKey(new Uint8Array(32).fill(7));
    store.set("space_1", key);

    const algorithm = await store.withKey("space_1", (cryptoKey) => {
      expect(cryptoKey.extractable).toBe(false);
      return (cryptoKey.algorithm as { name: string }).name;
    });
    expect(algorithm).toBe("AES-GCM");
    expect(store.has("space_1")).toBe(true);

    store.clear();
    expect(store.has("space_1")).toBe(false);
    await expect(store.withKey("space_1", () => 1)).rejects.toThrow(
      "ProductSpaceKey is locked",
    );
  });

  it("refuses extractable keys", async () => {
    const store = new ProductKeyStore("drive");
    const extractable = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(32).fill(3),
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
    expect(() => store.set("space_1", extractable)).toThrow("non-extractable");
  });
});
