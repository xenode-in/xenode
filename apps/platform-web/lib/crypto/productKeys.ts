"use client";

import { derivePurposeKey } from "@xenode/crypto-core";

export async function deriveDriveMetadataKey(
  productSpaceKey: Uint8Array,
  spaceId: string,
): Promise<CryptoKey> {
  const salt = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`xenode/drive/${spaceId}/metadata-salt/v1`),
    ),
  );
  const metadataBytes = await derivePurposeKey(
    productSpaceKey,
    "drive",
    "metadata",
    salt,
  );
  try {
    return await crypto.subtle.importKey(
      "raw",
      metadataBytes as BufferSource,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    metadataBytes.fill(0);
  }
}
