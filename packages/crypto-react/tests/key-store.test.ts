import { describe, expect, it } from "vitest";
import { importProductKey } from "@xenode/crypto-core";
import { ProductKeyStore } from "../src/key-store";
import { loadPersistedKey, savePersistedKey } from "../src/persistent-store";

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

  it("never reinstalls a key when lock wins an in-flight handoff", async () => {
    const store = new ProductKeyStore("drive");
    const key = await importProductKey(new Uint8Array(32).fill(9));
    let complete!: (key: CryptoKey) => void;
    const pending = store.unlock(
      "space_1",
      () =>
        new Promise<CryptoKey>((resolve) => {
          complete = resolve;
        }),
    );
    store.clear();
    complete(key);
    await expect(pending).rejects.toThrow("locked during unlock");
    expect(store.has("space_1")).toBe(false);
  });

  it("does not install a key when the interactive attempt is cancelled during import", async () => {
    const store = new ProductKeyStore("drive");
    const controller = new AbortController();
    const key = await importProductKey(new Uint8Array(32).fill(5));
    let complete!: (key: CryptoKey) => void;
    const pending = store.unlock("space_1", () => new Promise<CryptoKey>((resolve) => {
      complete = resolve;
    }), controller.signal);
    controller.abort();
    complete(key);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(store.has("space_1")).toBe(false);
  });

  it("does not start loading for an already cancelled attempt", async () => {
    const store = new ProductKeyStore("photos");
    const controller = new AbortController();
    controller.abort();
    let loaded = false;
    await expect(store.unlock("space_1", async () => {
      loaded = true;
      return importProductKey(new Uint8Array(32).fill(6));
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(loaded).toBe(false);
    expect(store.has("space_1")).toBe(false);
  });

  it("refuses any durable product or ARK key while retaining the explicit browser-device seam", async () => {
    const key = await importProductKey(new Uint8Array(32).fill(4));
    await expect(savePersistedKey("drive", "space_1", key)).rejects.toThrow(
      "Only consented browser-device",
    );
    await expect(savePersistedKey("photos", "space_1", key)).rejects.toThrow(
      "Only consented browser-device",
    );
    await expect(
      savePersistedKey("accounts-ark", "account_1", key),
    ).rejects.toThrow("Only consented browser-device");
    await expect(loadPersistedKey("drive", "space_1")).resolves.toBeNull();
    await expect(
      savePersistedKey("accounts-device-wrap", "device_1", key),
    ).resolves.toBeUndefined();
  });
});
