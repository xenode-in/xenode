/**
 * hooks/useVideoStream.ts
 *
 * Streams an AES-GCM encrypted chunked video/audio file by downloading and decrypting
 * each chunk on the fly, feeding them into a MediaSource SourceBuffer.
 */

import { useEffect, useRef, useState } from "react";
import { decryptChunk } from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

export interface VideoStreamOptions {
  urls: string[];
  dek: CryptoKey | null;
  chunkSize: number;
  chunkCount: number;
  chunkIvs: string[];
  contentType: string;
}

export interface VideoStreamState {
  blobUrl: string | null;
  error: string | null;
  isBuffering: boolean;
}

export function useVideoStream(
  opts: VideoStreamOptions | null,
  videoElement: HTMLMediaElement | null
): VideoStreamState {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);

  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  
  const currentChunkIndexRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);
  const activeBufferQueue = useRef<ArrayBuffer[]>([]);
  const isAppendingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!opts || !videoElement) return;

    const { urls, dek, chunkSize, chunkCount, chunkIvs, contentType } = opts;

    setBlobUrl(null);
    setError(null);
    setIsBuffering(false);
    
    currentChunkIndexRef.current = 0;
    isFetchingRef.current = false;
    activeBufferQueue.current = [];
    isAppendingRef.current = false;

    let isActive = true;
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;

    const url = URL.createObjectURL(mediaSource);
    blobUrlRef.current = url;
    setBlobUrl(url);

    // Default codec for MP4 if not specified in contentType
    const mimeType = contentType.includes("codecs=") ? contentType : `${contentType}; codecs="avc1.42E01E, mp4a.40.2"`;

    mediaSource.addEventListener("sourceopen", () => {
      if (!isActive) return;
      
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(
          MediaSource.isTypeSupported(mimeType) ? mimeType : 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        );
        sourceBufferRef.current = sourceBuffer;

        sourceBuffer.addEventListener("updateend", () => {
          isAppendingRef.current = false;
          processQueue();
        });

        // Initial buffer
        fetchNextChunk();
      } catch (e: any) {
        setError(e.message || "Failed to initialize SourceBuffer");
      }
    });

    const processQueue = () => {
      if (!isActive || !sourceBufferRef.current || sourceBufferRef.current.updating || activeBufferQueue.current.length === 0) {
        return;
      }

      isAppendingRef.current = true;
      const buffer = activeBufferQueue.current.shift()!;
      try {
        sourceBufferRef.current.appendBuffer(buffer);
      } catch (e: any) {
        console.error("AppendBuffer error:", e);
        setError(e.message || "Failed to append buffer");
      }
    };

    const fetchNextChunk = async () => {
      if (isFetchingRef.current || !isActive || currentChunkIndexRef.current >= chunkCount) return;
      
      isFetchingRef.current = true;
      setIsBuffering(true);

      const index = currentChunkIndexRef.current;
      currentChunkIndexRef.current++;

      try {
        const res = await fetch(urls[index]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const cipherChunk = await res.arrayBuffer();
        const plainChunk = dek 
          ? await decryptChunk(cipherChunk, dek, chunkIvs[index])
          : cipherChunk;

        activeBufferQueue.current.push(plainChunk);
        processQueue();
      } catch (e: any) {
        if (isActive) {
          setError(e.message || `Failed to fetch chunk ${index}`);
        }
      } finally {
        if (isActive) {
          isFetchingRef.current = false;
          setIsBuffering(false);
          // Recursively fetch if we need more buffering
          checkBufferAndFetch();
        }
      }
    };

    const checkBufferAndFetch = () => {
      if (!isActive || isFetchingRef.current || !videoElement || !sourceBufferRef.current) return;
      
      const buffered = sourceBufferRef.current.buffered;
      let bufferedEnd = 0;
      if (buffered.length > 0) {
        bufferedEnd = buffered.end(buffered.length - 1);
      }

      // If less than 15 seconds of video is buffered ahead of current time, fetch next
      const currentTime = videoElement.currentTime;
      if (bufferedEnd - currentTime < 15 && currentChunkIndexRef.current < chunkCount) {
        fetchNextChunk();
      } else if (currentChunkIndexRef.current >= chunkCount && mediaSource.readyState === "open" && !sourceBufferRef.current.updating) {
        mediaSource.endOfStream();
      }
    };

    const onTimeUpdate = () => {
      checkBufferAndFetch();
    };

    const onSeeking = () => {
      if (!isActive || !sourceBufferRef.current) return;
      
      // Basic seeking: estimate chunk index based on average bitrate
      const targetTime = videoElement.currentTime;
      const duration = videoElement.duration;
      
      if (!duration || isNaN(duration)) return;
      
      const totalBytes = chunkSize * chunkCount;
      const avgBitrate = totalBytes / duration; // bytes per second
      
      const estimatedByteTarget = targetTime * avgBitrate;
      let targetChunkIndex = Math.floor(estimatedByteTarget / chunkSize);
      targetChunkIndex = Math.max(0, Math.min(targetChunkIndex, chunkCount - 1));

      // Check if the target time is already buffered
      const buffered = sourceBufferRef.current.buffered;
      let isBuffered = false;
      for (let i = 0; i < buffered.length; i++) {
        if (targetTime >= buffered.start(i) && targetTime <= buffered.end(i)) {
          isBuffered = true;
          break;
        }
      }

      if (!isBuffered) {
        // We need to seek and fetch new chunk
        currentChunkIndexRef.current = targetChunkIndex;
        // Abort current source buffer and active queue
        try {
          sourceBufferRef.current.abort();
          activeBufferQueue.current = [];
          isAppendingRef.current = false;
        } catch (e) {
          console.warn("SourceBuffer abort warning", e);
        }
        
        fetchNextChunk();
      }
    };

    videoElement.addEventListener("timeupdate", onTimeUpdate);
    videoElement.addEventListener("seeking", onSeeking);

    return () => {
      isActive = false;
      videoElement.removeEventListener("timeupdate", onTimeUpdate);
      videoElement.removeEventListener("seeking", onSeeking);
      
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch (e) {}
      }
    };
  }, [opts, videoElement]);

  return { blobUrl, error, isBuffering };
}
