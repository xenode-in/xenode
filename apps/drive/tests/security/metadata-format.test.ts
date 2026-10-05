import { describe, expect, it } from "vitest";
import {
  decryptMetadataObject,
  decryptMetadataString,
  decryptThumbnail,
  encryptMetadataObject,
  encryptMetadataString,
  encryptThumbnail,
} from "@/lib/crypto/fileEncryption";

const FILE = "65f0000000000000000000aa";
const OTHER = "65f0000000000000000000bb";
const name = (fileId: string) => ({ fileId, purpose: "name" as const });

async function metadataKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

describe("metadata ciphertext format", () => {
  it("opens a value only as its own file's metadata of the same purpose", async () => {
    const key = await metadataKey();
    const sealed = await encryptMetadataString("report.pdf", key, name(FILE));
    expect(await decryptMetadataString(sealed, key, name(FILE))).toBe("report.pdf");
    // Shown on another file, or read as a content type: never.
    expect(await decryptMetadataString(sealed, key, name(OTHER))).toBe("Encrypted File");
    expect(await decryptMetadataString(sealed, key, { fileId: FILE, purpose: "content-type" }))
      .toBe("Encrypted File");

    const metadata = await encryptMetadataObject({ width: 4 }, key, FILE);
    expect(await decryptMetadataObject(metadata, key, FILE)).toEqual({ width: 4 });
    await expect(decryptMetadataObject(metadata, key, OTHER)).rejects.toThrow();
  });

  it("rejects the retired unbound and self-keyed formats", async () => {
    const key = await metadataKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const unbound = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("report.pdf")),
    );
    const retired = Buffer.from([0x02, ...iv, ...unbound]).toString("base64");
    expect(await decryptMetadataString(retired, key, name(FILE))).toBe("Encrypted File");

    // The oldest format carried its own AES key ([key 32][iv 12][ciphertext]),
    // so anyone could forge it and the server could read it.
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    rawKey[0] = 0x01;
    const selfKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, selfKey, new TextEncoder().encode("report.pdf")),
    );
    const selfKeyed = Buffer.from([...rawKey, ...iv, ...cipher]).toString("base64");
    expect(await decryptMetadataString(selfKeyed, key, name(FILE))).toBe("Encrypted File");
  });

  it("renders only a bound image thumbnail", async () => {
    const key = await metadataKey();
    const dataUrl = "data:image/jpeg;base64,/9j/";
    const sealed = await encryptThumbnail(dataUrl, key, FILE);
    expect(await decryptThumbnail(sealed, key, FILE)).toBe(dataUrl);
    expect(await decryptThumbnail(sealed, key, OTHER)).toBe("");
    // A server-supplied plaintext data URL is never passed through.
    expect(await decryptThumbnail(dataUrl, key, FILE)).toBe("");
    const script = await encryptThumbnail("javascript:alert(1)", key, FILE);
    expect(await decryptThumbnail(script, key, FILE)).toBe("");
  });
});
