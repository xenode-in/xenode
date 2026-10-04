"use client";

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateOrgSpaceKey(): Uint8Array {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return raw;
}

export async function wrapSpaceKeyForPublicKey(args: {
  rawSpaceKey: Uint8Array;
  recipientPublicKey: string;
}): Promise<string> {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    base64ToBytes(args.recipientPublicKey).buffer as ArrayBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    args.rawSpaceKey.buffer.slice(
      args.rawSpaceKey.byteOffset,
      args.rawSpaceKey.byteOffset + args.rawSpaceKey.byteLength,
    ) as ArrayBuffer,
  );
  return bytesToBase64(ciphertext);
}

export async function wrapSpaceKeyForCryptoKey(args: {
  rawSpaceKey: Uint8Array;
  publicKey: CryptoKey;
}): Promise<string> {
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    args.publicKey,
    args.rawSpaceKey.buffer.slice(
      args.rawSpaceKey.byteOffset,
      args.rawSpaceKey.byteOffset + args.rawSpaceKey.byteLength,
    ) as ArrayBuffer,
  );
  return bytesToBase64(ciphertext);
}

export async function unwrapSpaceKeyGrant(args: {
  wrappedSpaceKey: string;
  privateKey: CryptoKey;
}): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    args.privateKey,
    base64ToBytes(args.wrappedSpaceKey).buffer as ArrayBuffer,
  );
  return new Uint8Array(plaintext);
}

export interface SpaceKeyringEntry {
  keyVersion: number;
  rawSpaceKey: Uint8Array;
}

/** Unwrap every Space key version this member holds, newest first. */
export async function unwrapSpaceKeyring(args: {
  keys: Array<{ wrappedKey: string; keyVersion: number }>;
  privateKey: CryptoKey;
}): Promise<SpaceKeyringEntry[]> {
  const keyring = await Promise.all(
    args.keys.map(async (grant) => ({
      keyVersion: grant.keyVersion,
      rawSpaceKey: await unwrapSpaceKeyGrant({
        wrappedSpaceKey: grant.wrappedKey,
        privateKey: args.privateKey,
      }),
    })),
  );
  return keyring.sort((left, right) => right.keyVersion - left.keyVersion);
}

/**
 * One grant per version: a new keyholder needs every version to read content
 * written before the latest rotation, and the server refuses partial sets.
 */
export async function wrapSpaceKeyringForPublicKey(args: {
  keyring: SpaceKeyringEntry[];
  recipientPublicKey: string;
}): Promise<Array<{ keyVersion: number; wrappedKey: string }>> {
  return Promise.all(
    args.keyring.map(async (entry) => ({
      keyVersion: entry.keyVersion,
      wrappedKey: await wrapSpaceKeyForPublicKey({
        rawSpaceKey: entry.rawSpaceKey,
        recipientPublicKey: args.recipientPublicKey,
      }),
    })),
  );
}
