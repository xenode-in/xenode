import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptMetadataString, encryptMetadataString } from "@/lib/crypto/fileEncryption";
import { generateOrgSpaceKey, wrapSpaceKeyForCryptoKey } from "@/lib/orgs/spaceKeyClient";
import { keyringWithVersion, keyVersionOf, loadWorkspaceKeyring } from "@/lib/orgs/workspaceKeyring";

async function vaultKeys() {
  return crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    false,
    ["encrypt", "decrypt"],
  );
}

describe("workspace keyring", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps every version, derives per-version metadata keys and refreshes for newer records", async () => {
    const { publicKey, privateKey } = await vaultKeys();
    const [v1, v2, v3] = [generateOrgSpaceKey(), generateOrgSpaceKey(), generateOrgSpaceKey()];
    const grant = async (rawSpaceKey: Uint8Array, keyVersion: number) => ({
      keyVersion,
      wrappedKey: await wrapSpaceKeyForCryptoKey({ rawSpaceKey, publicKey }),
    });
    let served = [await grant(v2, 2), await grant(v1, 1)];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: served })));
    vi.stubGlobal("fetch", fetchMock);
    const scope = { orgId: "org_keyring", privateKey };

    const keyring = await loadWorkspaceKeyring(scope);
    expect(keyring.current.keyVersion).toBe(2);
    expect(keyVersionOf(keyring, 1)?.rawKey).toEqual(v1);

    // A name written under v1 decrypts only with v1's HKDF metadata key — not
    // with the newer version and not with the raw Space key itself.
    const binding = { fileId: "65f0000000000000000000cc", purpose: "name" as const };
    const name = await encryptMetadataString("Q3 plan.xlsx", keyVersionOf(keyring, 1)!.metadataKey, binding);
    expect(await decryptMetadataString(name, keyVersionOf(keyring, 1)!.metadataKey, binding)).toBe("Q3 plan.xlsx");
    expect(await decryptMetadataString(name, keyring.current.metadataKey, binding)).toBe("Encrypted File");
    const rawAsKey = await crypto.subtle.importKey("raw", new Uint8Array(v1), "AES-GCM", false, ["decrypt"]);
    expect(await decryptMetadataString(name, rawAsKey, binding)).toBe("Encrypted File");

    await loadWorkspaceKeyring(scope);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Another member rotated to v3 and created a record: one reload, history kept.
    served = [await grant(v3, 3), ...served];
    const refreshed = await keyringWithVersion(scope, 3);
    expect(refreshed.current.keyVersion).toBe(3);
    expect(keyVersionOf(refreshed, 1)?.rawKey).toEqual(v1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await keyringWithVersion(scope, 2)).toBe(refreshed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
