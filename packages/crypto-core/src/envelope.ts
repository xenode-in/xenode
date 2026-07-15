import { decodeBase64Url, encodeBase64Url, utf8 } from "./encoding";
import {
  ENVELOPE_ALGORITHM,
  ENVELOPE_FORMAT_VERSION,
  type CryptoEnvelope,
  type EnvelopeContext,
} from "./types";

function aad(context: EnvelopeContext): Uint8Array {
  return utf8(
    [
      "xenode-envelope",
      "1",
      context.accountId,
      context.spaceId ?? "",
      context.productId ?? "",
      context.keyId,
      String(context.keyVersion),
      context.type,
    ].join("\u001f"),
  );
}

function sameContext(left: EnvelopeContext, right: EnvelopeContext): boolean {
  return (
    left.accountId === right.accountId &&
    (left.spaceId ?? "") === (right.spaceId ?? "") &&
    (left.productId ?? "") === (right.productId ?? "") &&
    left.keyId === right.keyId &&
    left.keyVersion === right.keyVersion &&
    left.type === right.type
  );
}

async function importWrappingKey(rawKey: Uint8Array, usage: KeyUsage) {
  if (rawKey.length !== 32) throw new Error("Wrapping keys must be 256 bits");
  return crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "AES-GCM" },
    false,
    [usage],
  );
}

export async function sealEnvelope(
  plaintext: Uint8Array,
  wrappingKey: Uint8Array,
  context: EnvelopeContext,
  now = new Date(),
): Promise<CryptoEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importWrappingKey(wrappingKey, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad(context) as BufferSource,
      tagLength: 128,
    },
    key,
    plaintext as BufferSource,
  );
  return {
    ...context,
    formatVersion: ENVELOPE_FORMAT_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    iv: encodeBase64Url(iv),
    aadVersion: 1,
    createdAt: now.toISOString(),
    status: "active",
  };
}

export async function openEnvelope(
  envelope: CryptoEnvelope,
  wrappingKey: Uint8Array,
  expectedContext: EnvelopeContext,
): Promise<Uint8Array> {
  if (
    envelope.formatVersion !== ENVELOPE_FORMAT_VERSION ||
    envelope.algorithm !== ENVELOPE_ALGORITHM ||
    envelope.aadVersion !== 1 ||
    envelope.status !== "active" ||
    !sameContext(envelope, expectedContext)
  ) {
    throw new Error("Envelope context or format mismatch");
  }
  const key = await importWrappingKey(wrappingKey, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64Url(envelope.iv) as BufferSource,
      additionalData: aad(expectedContext) as BufferSource,
      tagLength: 128,
    },
    key,
    decodeBase64Url(envelope.ciphertext) as BufferSource,
  );
  return new Uint8Array(plaintext);
}

export async function openRsaOaepProductSpaceKey(
  ciphertext: string,
  privateKeyPkcs8: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyPkcs8 as BufferSource,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        decodeBase64Url(ciphertext) as BufferSource,
      ),
    );
  } catch (error) {
    throw new Error("RSA product-space-key decryption failed", {
      cause: error,
    });
  }
  if (plaintext.length !== 32) {
    plaintext.fill(0);
    throw new Error("ProductSpaceKey must be 256 bits");
  }
  return plaintext;
}
