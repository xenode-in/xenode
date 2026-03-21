import { useState, useEffect } from "react";

/**
 * useThumbnail hook
 * Handles fetching, decrypting, and providing a Blob URL for a thumbnail.
 * Supports legacy base64, plaintext B2 keys, and encrypted B2 keys.
 *
 * @param thumbnail - The thumbnail data (base64) or B2 key (string)
 * @param decryptionKey - the CryptoKey used for decryption (metadataKey or shareKey)
 */
export function useThumbnail(
  thumbnail: string | undefined,
  decryptionKey: CryptoKey | null = null,
) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!thumbnail) {
      setUrl(null);
      return;
    }

    // 1. Handle legacy base64 thumbnails (plaintext)
    if (thumbnail.startsWith("data:")) {
      setUrl(thumbnail);
      return;
    }

    // 2. Handle encrypted thumbnails or B2 keys
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadThumbnail() {
      try {
        // Fetch signed URL from our API
        const res = await fetch(
          `/api/objects/thumbnail?key=${encodeURIComponent(thumbnail!)}`,
        );
        if (!res.ok) throw new Error("Thumbnail fetch failed");
        const { url: signedUrl } = await res.json();

        // Download from B2
        const fileRes = await fetch(signedUrl);
        if (!fileRes.ok) throw new Error("B2 download failed");
        const data = await fileRes.arrayBuffer();

        let blob: Blob;

        // Try to decode as text to check for "enc:" prefix
        const text = new TextDecoder().decode(data);
        if (text.startsWith("enc:") && decryptionKey) {
          const { decryptThumbnail } =
            await import("@/lib/crypto/fileEncryption");
          const decryptedB64 = await decryptThumbnail(text, decryptionKey);

          // decryptedB64 is a data:image/... base64 string
          // Convert it to a blob and then to an object URL for memory efficiency/avoiding 431
          const response = await fetch(decryptedB64);
          blob = await response.blob();
        } else {
          // Plaintext or missing key - assume it's raw image bytes
          // If it was meant to be encrypted but we have no key, this will show a broken image
          // which is correct/expected behavior for unauthorized access.
          blob = new Blob([data], { type: "image/jpeg" });
        }

        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch (err) {
        console.error("useThumbnail error:", err);
        if (!cancelled) setUrl(null);
      }
    }

    loadThumbnail();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnail, decryptionKey]);

  return url;
}
