import { decodeBase64Url, utf8 } from "./encoding";

export const PASSKEY_WRAP_INFO = "xenode/ark-passkey-wrap/v1" as const;

export async function generateDeviceWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function derivePasskeyWrappingKey(
  prfOutput: Uint8Array,
  hkdfSaltBase64Url: string,
): Promise<CryptoKey> {
  if (prfOutput.length !== 32) {
    throw new Error("WebAuthn PRF output must be 256 bits");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: decodeBase64Url(hkdfSaltBase64Url) as BufferSource,
      info: utf8(PASSKEY_WRAP_INFO) as BufferSource,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
