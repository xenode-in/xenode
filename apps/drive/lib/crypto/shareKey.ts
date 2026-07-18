"use client";

import { fromB64, toB64 } from "./utils";

export function bytesToBase64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromB64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export async function encryptShareKeyForOwner(
  shareKeyRaw: Uint8Array,
  publicKey: CryptoKey,
): Promise<string> {
  const wrapped = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    shareKeyRaw.buffer.slice(
      shareKeyRaw.byteOffset,
      shareKeyRaw.byteOffset + shareKeyRaw.byteLength,
    ) as ArrayBuffer,
  );
  return toB64(wrapped);
}

export async function decryptOwnerShareKey(
  ownerEncryptedShareKey: string,
  privateKey: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromB64(ownerEncryptedShareKey),
  );
  return new Uint8Array(raw) as Uint8Array<ArrayBuffer>;
}

export async function importShareKey(
  shareKeyRaw: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    shareKeyRaw.buffer.slice(
      shareKeyRaw.byteOffset,
      shareKeyRaw.byteOffset + shareKeyRaw.byteLength,
    ) as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    usages,
  );
}
