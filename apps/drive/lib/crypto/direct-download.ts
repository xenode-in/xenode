import { decryptFileContent, decryptFilePart, parseChunkIvs } from "./fileEncryption";

export interface CiphertextUrls { objectId: string; url?: string; chunkUrls?: string[] }
/** Fetch one encrypted part at a time; authentication precedes publishing a Blob. */
export async function downloadCiphertextBlob(urls: CiphertextUrls, key: CryptoKey,
  layout: { iv?: string | null; chunkIvs?: string | null; chunkSize?: number | null }, fileId: string, type: string) {
  if (urls.objectId !== fileId) throw new Error("Download identity mismatch");
  const parts: ArrayBuffer[] = [];
  if (urls.chunkUrls) {
    if (!layout.chunkIvs || !layout.chunkSize) throw new Error("Missing multipart layout");
    const ivs = parseChunkIvs(layout.chunkIvs);
    if (ivs.length !== urls.chunkUrls.length || !ivs.length) throw new Error("Invalid multipart layout");
    for (let index = 0; index < ivs.length; index++) {
      const response = await fetch(urls.chunkUrls[index], { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("Ciphertext fetch failed; request fresh access and retry");
      const sealed = await response.arrayBuffer();
      const expected = layout.chunkSize + 16;
      if (sealed.byteLength < 16 || sealed.byteLength > expected || (index < ivs.length - 1 && sealed.byteLength !== expected)) throw new Error("Invalid ciphertext part length");
      parts.push(await decryptFilePart(sealed, key, ivs[index], fileId, index, ivs.length));
    }
    return new Blob(parts, { type });
  }
  if (!urls.url) throw new Error("Missing download URL");
  const response = await fetch(urls.url, { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error("Ciphertext fetch failed; request fresh access and retry");
  return decryptFileContent(await response.arrayBuffer(), key, layout, fileId, type);
}
