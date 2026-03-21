/**
 * lib/crypto/utils.ts
 * Shared helpers for the client-side E2EE crypto layer.
 * All functions run in the browser — never import this on the server.
 */

export const KDF_CONFIG = {
  name: "PBKDF2",
  hash: "SHA-256",
  iterations: 600_000,
} as const;

export const CRYPTO_VERSION = 2;

export interface MetadataEnvelope {
  version: number;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

/** Encode an ArrayBuffer (or TypedArray) to a Base64 string */
export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a Base64 string to a Uint8Array<ArrayBuffer> */
export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes as Uint8Array<ArrayBuffer>;
}

/**
 * Derive an AES-256-GCM CryptoKey from a password + salt using PBKDF2-SHA256.
 * Using canonical KDF_CONFIG.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  purpose: "AES-GCM" | "HMAC" = "AES-GCM",
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );

  const algorithm =
    purpose === "AES-GCM"
      ? { name: "AES-GCM", length: 256 }
      : { name: "HMAC", hash: "SHA-256", length: 256 };

  const usages: KeyUsage[] =
    purpose === "AES-GCM" ? ["encrypt", "decrypt"] : ["sign", "verify"];

  return crypto.subtle.deriveKey(
    {
      ...KDF_CONFIG,
      salt,
    },
    keyMaterial,
    algorithm,
    false,
    usages,
  );
}

/**
 * Calculates HMAC-SHA256 for a given buffer using a CryptoKey.
 */
export async function hmacSha256(
  key: CryptoKey,
  data: ArrayBuffer | Uint8Array,
): Promise<ArrayBuffer> {
  // Ensure we don't pass SharedArrayBuffer to Web Crypto (which some environments forbid)
  const buffer = data instanceof Uint8Array ? data.buffer : data;
  if (buffer instanceof SharedArrayBuffer) {
    return crypto.subtle.sign("HMAC", key, new Uint8Array(data));
  }
  return crypto.subtle.sign("HMAC", key, data as BufferSource);
}

/**
 * Packs a versioned metadata envelope into a single Uint8Array for storage.
 * Format: [1 byte version][12 bytes IV][ciphertext...]
 */
export function packEnvelope(envelope: MetadataEnvelope): Uint8Array {
  const packed = new Uint8Array(1 + envelope.iv.length + envelope.ciphertext.byteLength);
  packed[0] = envelope.version;
  packed.set(envelope.iv, 1);
  packed.set(new Uint8Array(envelope.ciphertext), 1 + envelope.iv.length);
  return packed;
}

/**
 * Unpacks a versioned metadata envelope.
 */
export function unpackEnvelope(packed: Uint8Array): MetadataEnvelope {
  return {
    version: packed[0],
    iv: packed.slice(1, 13) as Uint8Array<ArrayBuffer>,
    ciphertext: packed.slice(13) as Uint8Array<ArrayBuffer>,
  };
}
