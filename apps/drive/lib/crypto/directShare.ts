import {
  decryptFileContent,
  decryptFilePart,
  parseChunkIvs,
  unwrapShareFileKey,
} from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

/**
 * Client-side helpers for opening a DirectShare's encrypted payload. Shared by
 * the personal Shared-With-Me detail page and the org Shared-With-Me surface so
 * the E2EE unwrap path lives in one place.
 *
 * Chain: RSA-unwrap the recipient's `wrappedShareKey` with their private key →
 * AES share key → unwrap the file DEK (bound to the file) → decrypt content.
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

/** Unwrap a shared file's key, which the share key wraps bound to that file. */
export function buildDek(
  shareKey: CryptoKey,
  shareEncryptedDEK: string,
  shareKeyIv: string,
  fileId: string,
): Promise<CryptoKey> {
  return unwrapShareFileKey(shareEncryptedDEK, shareKeyIv, shareKey, fileId);
}

export interface ShareBlobResponse {
  streamUrl?: string;
  downloadUrl?: string;
  chunkUrls?: string[];
  iv?: string;
  contentType: string;
  chunkIvs?: string;
  error?: string;
}

/**
 * Fetch and decrypt a DirectShare's bytes. `mode` selects the stream vs download
 * endpoint. Drive content is always encrypted, so there is no plaintext path.
 */
export async function fetchShareBlob(args: {
  shareId: string;
  fileId: string;
  mode: "stream" | "download";
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

  if (
    !args.privateKey ||
    !args.wrappedShareKey ||
    !args.shareEncryptedDEK ||
    !args.shareKeyIv
  ) {
    throw new Error("Unlock your vault to open this encrypted share");
  }

  const shareKey = await buildShareKey(args.wrappedShareKey, args.privateKey);
  const dek = await buildDek(shareKey, args.shareEncryptedDEK, args.shareKeyIv, args.fileId);

  if (data.chunkUrls?.length) {
    // The authenticated chunk count comes from the IVs; every part must be present.
    const chunkIvs = parseChunkIvs(data.chunkIvs || "[]");
    if (chunkIvs.length !== data.chunkUrls.length) throw new Error("Incomplete shared file");
    const plaintextChunks: BlobPart[] = [];
    for (let i = 0; i < chunkIvs.length; i += 1) {
      const chunkBuffer = await fetch(data.chunkUrls[i]).then((r) => r.arrayBuffer());
      plaintextChunks.push(
        await decryptFilePart(chunkBuffer, dek, chunkIvs[i], args.fileId, i, chunkIvs.length),
      );
    }
    return new Blob(plaintextChunks, { type: outType });
  }

  const sourceUrl = data.streamUrl || data.downloadUrl;
  if (!sourceUrl || !data.iv) throw new Error("Missing encrypted file URL");

  const cipherBuffer = await fetch(sourceUrl).then((r) => r.arrayBuffer());
  return decryptFileContent(cipherBuffer, dek, { iv: data.iv }, args.fileId, outType);
}
