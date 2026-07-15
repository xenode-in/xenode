import { describe, expect, it } from "vitest";
import {
  consumeProductSpaceKey,
  createProductHandoffRequest,
  exportHandoffPublicKey,
  generateHandoffKeyPair,
  parseSealedHandoff,
  sealProductSpaceKey,
  type HandoffBinding,
  type HandoffStore,
} from "../src";

function oneTimeStore(): HandoffStore {
  const consumed = new Set<string>();
  return {
    async consume(id) {
      if (consumed.has(id)) return false;
      consumed.add(id);
      return true;
    },
  };
}

const binding: HandoffBinding = {
  transactionId: "tx_1",
  accountId: "acct_1",
  clientId: "photos-web",
  productId: "photos",
  spaceId: "space_1",
  destinationOrigin: "https://photos.xenode.in",
  state: "state_1",
  nonce: "nonce_1",
};

describe("encrypted key handoff", () => {
  it("delivers only the requested product key and is single use", async () => {
    const destination = await generateHandoffKeyPair();
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealProductSpaceKey(
      key,
      await exportHandoffPublicKey(destination.publicKey),
      binding,
      new Date(Date.now() + 60_000),
    );
    const store = oneTimeStore();

    expect(
      await consumeProductSpaceKey(
        sealed,
        destination.privateKey,
        binding,
        store,
      ),
    ).toEqual(key);
    await expect(
      consumeProductSpaceKey(sealed, destination.privateKey, binding, store),
    ).rejects.toThrow("consumed");
  });

  it("rejects wrong origin, client, product, Space, state, and nonce", async () => {
    const destination = await generateHandoffKeyPair();
    const sealed = await sealProductSpaceKey(
      crypto.getRandomValues(new Uint8Array(32)),
      await exportHandoffPublicKey(destination.publicKey),
      binding,
      new Date(Date.now() + 60_000),
    );

    for (const changed of [
      { destinationOrigin: "https://evil.example" },
      { clientId: "drive-web" },
      { productId: "drive" },
      { spaceId: "space_2" },
      { state: "other" },
      { nonce: "other" },
    ]) {
      await expect(
        consumeProductSpaceKey(
          sealed,
          destination.privateKey,
          { ...binding, ...changed },
          oneTimeStore(),
        ),
      ).rejects.toThrow("binding");
    }
  });

  it("creates a fully bound broker request and rejects malformed payloads", async () => {
    const request = await createProductHandoffRequest({
      accountsOrigin: "https://accounts.xenode.in",
      accountId: "acct_1",
      clientId: "xenode-photos-web",
      productId: "photos",
      spaceId: "space_1",
      destinationOrigin: "https://photos.xenode.in",
    });
    const broker = new URL(request.brokerUrl);
    expect(broker.origin).toBe("https://accounts.xenode.in");
    expect(broker.pathname).toBe("/security/key-handoff");
    expect(broker.searchParams.get("transactionId")).toBe(
      request.binding.transactionId,
    );
    expect(broker.searchParams.get("productId")).toBe("photos");
    expect(request.destinationKeyPair.privateKey.extractable).toBe(false);

    const sealed = await sealProductSpaceKey(
      crypto.getRandomValues(new Uint8Array(32)),
      await exportHandoffPublicKey(request.destinationKeyPair.publicKey),
      request.binding,
      new Date(Date.now() + 60_000),
    );
    expect(parseSealedHandoff(JSON.stringify(sealed))).toEqual(sealed);
    expect(() =>
      parseSealedHandoff({
        ...sealed,
        destinationKeyFingerprint: "tampered",
      }),
    ).toThrow("Invalid sealed handoff");
  });
});
