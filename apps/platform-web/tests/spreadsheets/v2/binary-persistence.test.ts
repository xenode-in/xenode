import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { XenodeBinaryPersistenceAdapter } from "@/lib/spreadsheets/v2/persistence";
import { BinaryConflictError } from "@/lib/spreadsheets/v2/types";
import { encryptMetadataString } from "@/lib/crypto/fileEncryption";
import { toB64 } from "@/lib/crypto/utils";

// Node's WebCrypto satisfies the SubtleCrypto surface the adapter uses.
const subtle = (webcrypto as unknown as Crypto).subtle;
if (!globalThis.crypto) {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}

const OBJECT_ID = "0123456789abcdef01234567";
const PLAINTEXT = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 10, 20, 30, 40, 50, 60]);
const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface Recorded {
  url: string;
  method: string;
  body?: ArrayBuffer;
}

async function buildFixture() {
  const rsa = await subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
  const dek = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const metadataKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

  const rawDEK = await subtle.exportKey("raw", dek);
  const encryptedDEK = toB64(
    await subtle.encrypt({ name: "RSA-OAEP" }, rsa.publicKey, rawDEK),
  );

  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    PLAINTEXT.slice().buffer,
  );

  const meta = {
    encryptedDEK,
    encryptedName: await encryptMetadataString("book.xlsx", metadataKey),
    encryptedContentType: await encryptMetadataString(CONTENT_TYPE, metadataKey),
    contentType: CONTENT_TYPE,
    iv: toB64(iv),
    revision: 3,
    isEncrypted: true,
    wrappedBy: "user" as const,
    spaceKeyWrapIv: null,
    canWrite: true,
    url: "https://storage.test/encrypted-workbook",
  };

  return { rsa, dek, metadataKey, meta, ciphertext };
}

function jsonResponse(obj: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function binResponse(buf: ArrayBuffer) {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => buf,
  } as unknown as Response;
}

describe("v2 binary persistence — ciphertext only", () => {
  it("loads decrypted bytes and uploads only ciphertext", async () => {
    const { rsa, dek, metadataKey, meta, ciphertext } = await buildFixture();
    const recorded: Recorded[] = [];

    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      recorded.push({
        url,
        method,
        body: init?.body instanceof ArrayBuffer ? init.body : undefined,
      });
      if (url.endsWith(`/api/objects/${OBJECT_ID}`)) return jsonResponse(meta);
      if (url.includes("/versions/baseline")) return jsonResponse({ ok: true });
      if (url === meta.url) return binResponse(ciphertext);
      if (url.includes("/update-content")) return jsonResponse({ revision: 4 });
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const adapter = new XenodeBinaryPersistenceAdapter({
      fetch: fetchImpl,
      privateKey: rsa.privateKey,
      metadataKey,
      workspace: { type: "personal", workspaceId: "ws1" },
      storageFetch: fetchImpl,
    });

    const loaded = await adapter.loadBinary(OBJECT_ID);
    expect(loaded.name).toBe("book.xlsx");
    expect(loaded.extension).toBe("xlsx");
    expect(loaded.revision).toBe(3);
    expect(loaded.readOnly).toBe(false);
    expect(Array.from(loaded.bytes)).toEqual(Array.from(PLAINTEXT));

    // Save a new (edited) workbook and confirm the wire body is ciphertext.
    const edited = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 99, 98, 97, 96]);
    const result = await adapter.saveBinary({ loaded, bytes: edited });
    expect(result.revision).toBe(4);

    const save = recorded.find((r) => r.url.includes("/update-content"));
    expect(save).toBeDefined();
    expect(save!.method).toBe("POST");
    expect(save!.body).toBeInstanceOf(ArrayBuffer);

    // The posted body must NOT equal the plaintext, and must decrypt with the
    // DEK back to exactly the edited bytes.
    const postedBytes = new Uint8Array(save!.body!);
    expect(Array.from(postedBytes)).not.toEqual(Array.from(edited));
    const ivParam = new URL(save!.url, "https://x").searchParams.get("iv")!;
    const ivBytes = Uint8Array.from(atob(ivParam), (c) => c.charCodeAt(0));
    const roundTrip = new Uint8Array(
      await subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, dek, save!.body!),
    );
    expect(Array.from(roundTrip)).toEqual(Array.from(edited));

    // No request body anywhere in the session equals the plaintext.
    for (const r of recorded) {
      if (r.body) {
        expect(Array.from(new Uint8Array(r.body))).not.toEqual(Array.from(PLAINTEXT));
      }
    }
  });

  it("maps a 409 to BinaryConflictError with the latest revision", async () => {
    const { rsa, dek, metadataKey, meta, ciphertext } = await buildFixture();
    void dek;
    const fetchImpl = (async (url: string) => {
      if (url.endsWith(`/api/objects/${OBJECT_ID}`)) return jsonResponse(meta);
      if (url.includes("/versions/baseline")) return jsonResponse({ ok: true });
      if (url === meta.url) return binResponse(ciphertext);
      if (url.includes("/update-content")) return jsonResponse({ revision: 7 }, 409);
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const adapter = new XenodeBinaryPersistenceAdapter({
      fetch: fetchImpl,
      privateKey: rsa.privateKey,
      metadataKey,
      workspace: { type: "personal", workspaceId: "ws1" },
      storageFetch: fetchImpl,
    });
    const loaded = await adapter.loadBinary(OBJECT_ID);
    await expect(
      adapter.saveBinary({ loaded, bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toBeInstanceOf(BinaryConflictError);
  });

  it("refuses to save a read-only workbook", async () => {
    const { rsa, dek, metadataKey, meta, ciphertext } = await buildFixture();
    void dek;
    const readOnlyMeta = { ...meta, canWrite: false };
    const fetchImpl = (async (url: string) => {
      if (url.endsWith(`/api/objects/${OBJECT_ID}`)) return jsonResponse(readOnlyMeta);
      if (url === readOnlyMeta.url) return binResponse(ciphertext);
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const adapter = new XenodeBinaryPersistenceAdapter({
      fetch: fetchImpl,
      privateKey: rsa.privateKey,
      metadataKey,
      workspace: { type: "personal", workspaceId: "ws1" },
      storageFetch: fetchImpl,
    });
    const loaded = await adapter.loadBinary(OBJECT_ID);
    expect(loaded.readOnly).toBe(true);
    await expect(
      adapter.saveBinary({ loaded, bytes: new Uint8Array([1]) }),
    ).rejects.toThrow("spreadsheet_read_only");
  });
});
