import { decryptChunk } from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

/**
 * Client-side helpers for opening a DirectShare's encrypted payload. Shared by
 * the personal Shared-With-Me detail page and the org Shared-With-Me surface so
 * the E2EE unwrap path lives in one place.
 *
 * Chain: RSA-unwrap the recipient's `wrappedShareKey` with their private key →
 * AES share key → unwrap the file DEK → decrypt content.
 */

/** RSA-OAEP unwrap the per-recipient wrapped share key into an AES-GCM CryptoKey. */
export async function buildShareKey(
  wrappedShareKey: string,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  const rawShareKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromB64(wrappedShareKey).buffer as ArrayBuffer,
  );
  return crypto.subtle.importKey(
    "raw",
    rawShareKey,
    { name: "AES-GCM" },
    false,
    ["decrypt", "unwrapKey"],
  );
}

/** Unwrap the file DEK (wrapped with the share key) into an AES-GCM CryptoKey. */
export async function buildDek(
  shareKey: CryptoKey,
  shareEncryptedDEK: string,
  shareKeyIv: string,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    fromB64(shareEncryptedDEK).buffer as ArrayBuffer,
    shareKey,
    { name: "AES-GCM", iv: fromB64(shareKeyIv).buffer as ArrayBuffer },
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}

export interface ShareBlobResponse {
  streamUrl?: string;
  downloadUrl?: string;
  chunkUrls?: string[];
  isEncrypted: boolean;
  iv?: string;
  contentType: string;
  chunkIvs?: string;
  error?: string;
}

/**
 * Fetch and decrypt a DirectShare's bytes. `mode` selects the stream vs download
 * endpoint. Returns a decrypted Blob (or the raw blob for non-encrypted shares).
 */
export async function fetchShareBlob(args: {
  shareId: string;
  mode: "stream" | "download";
  isEncrypted?: boolean;
  wrappedShareKey?: string;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  privateKey: CryptoKey | null;
  contentType?: string;
}): Promise<Blob> {
  const res = await fetch(`/api/direct-shares/${args.shareId}/${args.mode}`, {
    method: "POST",
  });
  const data = (await res.json()) as ShareBlobResponse;
  if (!res.ok) throw new Error(data.error || `Failed to ${args.mode} file`);

  const outType = args.contentType || data.contentType;

  if (!data.isEncrypted) {
    const sourceUrl = data.streamUrl || data.downloadUrl;
    if (!sourceUrl) throw new Error("Missing file URL");
    const blob = await fetch(sourceUrl).then((r) => r.blob());
    return new Blob([blob], { type: outType });
  }

  if (
    !args.privateKey ||
    !args.wrappedShareKey ||
    !args.shareEncryptedDEK ||
    !args.shareKeyIv
  ) {
    throw new Error("Unlock your vault to open this encrypted share");
  }

  const shareKey = await buildShareKey(args.wrappedShareKey, args.privateKey);
  const dek = await buildDek(shareKey, args.shareEncryptedDEK, args.shareKeyIv);

  if (data.chunkUrls?.length) {
    const chunkIvs = JSON.parse(data.chunkIvs || "[]");
    const plaintextChunks: BlobPart[] = [];
    for (let i = 0; i < data.chunkUrls.length; i += 1) {
      const chunkBuffer = await fetch(data.chunkUrls[i]).then((r) =>
        r.arrayBuffer(),
      );
      plaintextChunks.push(await decryptChunk(chunkBuffer, dek, chunkIvs[i]));
    }
    return new Blob(plaintextChunks, { type: outType });
  }

  const sourceUrl = data.streamUrl || data.downloadUrl;
  if (!sourceUrl || !data.iv) throw new Error("Missing encrypted file URL");

  const cipherBuffer = await fetch(sourceUrl).then((r) => r.arrayBuffer());
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(data.iv).buffer as ArrayBuffer },
    dek,
    cipherBuffer,
  );
  return new Blob([plainBuffer], { type: outType });
}
