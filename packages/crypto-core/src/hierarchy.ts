import { concatBytes, encodeBase64Url, utf8 } from "./encoding";
import { openEnvelope, sealEnvelope } from "./envelope";
import type { CryptoEnvelope, EnvelopeContext } from "./types";

export function generateAccountRootKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function generateRecoverySecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function generateProductSpaceKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function generateMetadataKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function recoverySecretText(secret: Uint8Array): string {
  if (secret.length !== 32) throw new Error("Recovery secret must be 256 bits");
  return encodeBase64Url(secret);
}

export async function derivePurposeKey(
  rootKey: Uint8Array,
  productId: string,
  purpose: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (rootKey.length !== 32) throw new Error("Root key must be 256 bits");
  const key = await crypto.subtle.importKey(
    "raw",
    rootKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: concatBytes(
        utf8("xenode/"),
        utf8(productId),
        utf8("/"),
        utf8(purpose),
        utf8("/v1"),
      ) as BufferSource,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function wrapKey(
  keyMaterial: Uint8Array,
  wrappingKey: Uint8Array,
  context: EnvelopeContext,
): Promise<CryptoEnvelope> {
  return sealEnvelope(keyMaterial, wrappingKey, context);
}

export async function unwrapKey(
  envelope: CryptoEnvelope,
  wrappingKey: Uint8Array,
  context: EnvelopeContext,
): Promise<Uint8Array> {
  return openEnvelope(envelope, wrappingKey, context);
}
