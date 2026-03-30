import { useEffect } from "react";
import { startE2EEStream } from "@/lib/streaming/msePlayer";
import { decryptChunk } from "@/lib/crypto/fileEncryption";

export function useMSEStream(opts, videoEl) {
  useEffect(() => {
    if (!opts || !videoEl) return;

    const { urls, dek, chunkIvs, contentType } = opts;

    const mime = contentType === "video/mp4"
      ? 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
      : contentType;

    startE2EEStream({
      video: videoEl,
      urls,
      dek,
      ivs: chunkIvs,
      decryptChunk,
      mimeCodec: mime,
    });
  }, [opts, videoEl]);
}
