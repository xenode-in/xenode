import { describe, expect, it } from "vitest";
import { ProductKeyStore } from "../src/key-store";

describe("ProductKeyStore", () => {
  it("keeps only product-space keys and zeroes ephemeral copies", async () => {
    const store = new ProductKeyStore("photos");
    const input = new Uint8Array(32).fill(7);
    store.set("space_1", input);
    input.fill(0);

    let reference: Uint8Array | undefined;
    const value = await store.withKey("space_1", (key) => {
      reference = key;
      return key[0];
    });
    expect(value).toBe(7);
    expect(reference).toEqual(new Uint8Array(32));
    expect(store.has("space_1")).toBe(true);
    store.clear();
    expect(store.has("space_1")).toBe(false);
  });
});
