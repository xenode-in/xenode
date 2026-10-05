import { describe, expect, it } from "vitest";
import { decryptMetadataString, encryptMetadataString } from "@/lib/crypto/fileEncryption";

describe("metadata ciphertext format", () => {
  it("decrypts only values encrypted under the metadata key", async () => {
    const metadataKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const sealed = await encryptMetadataString("report.pdf", metadataKey);
    expect(await decryptMetadataString(sealed, metadataKey)).toBe("report.pdf");

    // The retired format carried its own AES key ([key 32][iv 12][ciphertext]),
    // so anyone could forge it and the server could read it: never accepted.
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    rawKey[0] = 0x01;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("report.pdf")),
    );
    const selfKeyed = Buffer.from([...rawKey, ...iv, ...cipher]).toString("base64");
    expect(await decryptMetadataString(selfKeyed, metadataKey)).toBe("Encrypted File");
  });
});
