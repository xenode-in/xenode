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

export async function encryptOrgFile(args: {
  file: File;
  rawSpaceKey: Uint8Array;
}): Promise<{
  encryptedBlob: Blob;
  encryptedDEK: string;
  iv: string;
  spaceKeyWrapIv: string;
  encryptedName: string;
}> {
  const spaceKey = await crypto.subtle.importKey(
    "raw",
    args.rawSpaceKey.buffer.slice(
      args.rawSpaceKey.byteOffset,
      args.rawSpaceKey.byteOffset + args.rawSpaceKey.byteLength,
    ) as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "wrapKey"],
  );
  const fileKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await args.file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    fileKey,
    plaintext,
  );

  const spaceKeyWrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedFileKey = await crypto.subtle.wrapKey(
    "raw",
    fileKey,
    spaceKey,
    { name: "AES-GCM", iv: spaceKeyWrapIv },
  );

  const nameIv = crypto.getRandomValues(new Uint8Array(12));
  const encodedName = new TextEncoder().encode(args.file.name);
  const encryptedNameBytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nameIv },
    spaceKey,
    encodedName,
  );

  return {
    encryptedBlob: new Blob([ciphertext], {
      type: "application/octet-stream",
    }),
    encryptedDEK: bytesToBase64(wrappedFileKey),
    iv: bytesToBase64(iv),
    spaceKeyWrapIv: bytesToBase64(spaceKeyWrapIv),
    encryptedName: `${bytesToBase64(nameIv)}:${bytesToBase64(encryptedNameBytes)}`,
  };
}
