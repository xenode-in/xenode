/// <reference lib="webworker" />

self.addEventListener("message", async (event) => {
  const { type, payload, jobId } = event.data;

  if (type === "DECRYPT_BATCH") {
    const { items, rawKey } = payload; // items: { id: string, ciphertext: string }[]
    try {
      let key: CryptoKey | null = null;
      if (rawKey) {
        key = await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"]
        );
      }

      const results = [];
      for (const item of items) {
        let plaintext = "Encrypted File";
        if (!item.ciphertext) {
            results.push({ id: item.id, ciphertext: item.ciphertext, plaintext: "Unknown" });
            continue;
        }

        try {
          const combined = Uint8Array.from(atob(item.ciphertext), (c) => c.charCodeAt(0));
          
          if (combined[0] === 0x02 && key) {
            const iv = combined.slice(1, 13);
            const ciphertext = combined.slice(13);
            const plain = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv },
              key,
              ciphertext
            );
            plaintext = new TextDecoder().decode(plain);
          } else if (combined.byteLength >= 44) {
            const nameKeyBytes = combined.slice(0, 32);
            const nameIV = combined.slice(32, 44);
            const ciphertext = combined.slice(44);
            const legacyKey = await crypto.subtle.importKey(
              "raw", nameKeyBytes, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
            );
            const plain = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: nameIV }, legacyKey, ciphertext,
            );
            plaintext = new TextDecoder().decode(plain);
          }
        } catch (e) {
          // Ignore and just use fallback
        }
        
        results.push({ id: item.id, ciphertext: item.ciphertext, plaintext });
      }

      self.postMessage({ type: "DECRYPT_BATCH_RESULT", jobId, results });
    } catch (err: any) {
      self.postMessage({ type: "DECRYPT_BATCH_ERROR", jobId, error: err.message });
    }
  }
});
