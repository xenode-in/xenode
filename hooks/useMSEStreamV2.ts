import { useEffect } from "react";
import { createMSEController } from "@/lib/streaming/mseController";

export function useMSEStreamV2(opts, videoEl) {
  useEffect(() => {
    if (!opts || !videoEl) return;

    const { urls, dek, chunkIvs, contentType } = opts;

    const mediaSource = new MediaSource();
    videoEl.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener("sourceopen", () => {
      const sb = mediaSource.addSourceBuffer(
        contentType === "video/mp4"
          ? 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
          : contentType
      );

      const fetchChunk = async (i) => {
        const res = await fetch(urls[i]);
        return res.arrayBuffer();
      };

      const decryptChunk = async (buf, i) => {
        if (!dek) return buf;
        const { decryptChunk } = await import("@/lib/crypto/fileEncryption");
        return decryptChunk(buf, dek, chunkIvs[i]);
      };

      createMSEController({
        video: videoEl,
        sourceBuffer: sb,
        fetchChunk,
        decryptChunk,
        totalChunks: urls.length,
        chunkDuration: 2, // assume 2s per chunk (tune later)
      });
    });
  }, [opts, videoEl]);
}
