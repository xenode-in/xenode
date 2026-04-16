/**
 * hooks/useAudioTrackSyncer.ts
 *
 * Syncs a decrypted audio sidecar (AAC blob) to a <video> element using
 * the Web Audio API. The video element's native audio is muted, and the
 * sidecar plays through AudioContext, tightly synced to video.currentTime.
 *
 * Usage:
 *   const { selectTrack, activeTrackId, isLoading } = useAudioTrackSyncer({
 *     videoElement,
 *     audioTracks,
 *     dek,
 *   });
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decryptFileChunkedCombined } from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

export interface SidecarAudioTrack {
  id: string;
  language: string;
  title?: string;
  objectId?: string; // DB object ID to fetch chunk URLs
}

interface UseAudioTrackSyncerOpts {
  videoElement: HTMLMediaElement | null;
  audioTracks: SidecarAudioTrack[];
  /** The file's DEK — needed primarily for reference or fallback */
  dek: CryptoKey | null;
  /** Keys needed to decrypt sidecar-specific DEKs */
  privateKey?: CryptoKey | null;
  metadataKey?: CryptoKey | null;
}

interface AudioTrackSyncerState {
  activeTrackId: string | null;
  isLoading: boolean;
  error: string | null;
  selectTrack: (trackId: string | null) => void;
}

export function useAudioTrackSyncer({
  videoElement,
  audioTracks,
  dek,
  privateKey,
  metadataKey,
}: UseAudioTrackSyncerOpts): AudioTrackSyncerState {
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioBlobRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef<number>(0); // audioCtx time when play() was called
  const videoTimeRef = useRef<number>(0); // video.currentTime when play() was called

  // Initialize AudioContext lazily
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  }

  // Stop current sidecar playback
  const stopSidecar = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
  }, []);

  // Start playing the decoded AudioBuffer in sync with the video
  const playSynced = useCallback(
    (audioBuffer: AudioBuffer) => {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") ctx.resume();

      stopSidecar();

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNodeRef.current!);
      sourceNodeRef.current = source;

      const videoTime = videoElement?.currentTime ?? 0;
      videoTimeRef.current = videoTime;
      startedAtRef.current = ctx.currentTime;

      // Start playback at the correct position in the audio buffer
      const safeOffset = Math.min(videoTime, audioBuffer.duration);
      source.start(0, safeOffset);

      // Keep audio in sync with video during seeks and buffering
      syncIntervalRef.current = setInterval(() => {
        if (!videoElement || !sourceNodeRef.current) return;

        // Current synchronization source of truth
        const actualVideoTime = videoElement.currentTime;

        /**
         * Buffering detection:
         * readyState < 3 (HAVE_FUTURE_DATA) means the video doesn't have enough data
         * to play through the next few frames without stalling.
         */
        const isBuffering = videoElement.readyState < 3;
        const isPaused = videoElement.paused || videoElement.ended;
        const shouldBePlaying = !isPaused && !isBuffering;

        // Sync AudioContext state
        if (!shouldBePlaying && ctx.state === "running") {
          ctx.suspend();
        } else if (shouldBePlaying && ctx.state === "suspended") {
          ctx.resume();
        }

        // Only check for drift and potentially re-sync if the video is healthy
        if (shouldBePlaying) {
          const expectedAudioTime =
            ctx.currentTime - startedAtRef.current + videoTimeRef.current;
          const drift = Math.abs(actualVideoTime - expectedAudioTime);

          // If drift > 0.3s, re-sync by restarting the buffer source at current time
          if (drift > 0.3) {
            playSynced(audioBuffer);
          }
        }
      }, 250);
    },
    [videoElement, stopSidecar],
  );

  // Fetch, decrypt, decode a sidecar track by objectId
  const loadTrack = useCallback(
    async (track: SidecarAudioTrack) => {
      if (!track.objectId) return;

      setIsLoading(true);
      setError(null);
      console.log(`[AudioTrackSyncer] Loading track: ${track.language} (ID: ${track.objectId})`);

      try {
        // 1. Get signed chunk URLs and encryption info for the sidecar
        const infoRes = await fetch(
          `/api/objects/${track.objectId}?preview=true`,
        );
        if (!infoRes.ok) throw new Error("Failed to fetch sidecar info");
        const info = await infoRes.json();

        const chunkUrls: string[] =
          info.chunkUrls ?? (info.url ? [info.url] : []);
        
        let chunkIvs: string[] = [];
        try {
          chunkIvs = JSON.parse(info.chunkIvs ?? "[]");
        } catch (e) {
          console.warn("[AudioTrackSyncer] Failed to parse chunkIvs, using single iv fallback");
        }

        // If no chunk Ivs but a single IV exists, use it for the first chunk
        if (chunkIvs.length === 0 && info.iv) {
          chunkIvs = [info.iv];
        }

        console.log(`[AudioTrackSyncer] Info: isEncrypted=${info.isEncrypted}, chunks=${chunkUrls.length}, ivs=${chunkIvs.length}`);

        // 2. Derive the correct DEK for this specific sidecar
        // Default to null for encrypted sidecars to avoid accidentally sharing parent DEK
        let sidecarDek: CryptoKey | null = info.isEncrypted ? null : dek;

        if (info.isEncrypted) {
          if (info.encryptedDEK && privateKey) {
            try {
              console.log("[AudioTrackSyncer] Unwrapping sidecar DEK via RSA-OAEP...");
              const rawSidecarDek = await crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                privateKey,
                fromB64(info.encryptedDEK),
              );
              sidecarDek = await crypto.subtle.importKey(
                "raw",
                rawSidecarDek,
                { name: "AES-GCM", length: 256 },
                false,
                ["decrypt"],
              );
              console.log("[AudioTrackSyncer] Sidecar DEK unwrapped successfully.");
            } catch (dekError) {
              console.error("[AudioTrackSyncer] RSA Decryption of sidecar DEK failed:", dekError);
              throw new Error("Failed to decrypt audio track key (RSA error)");
            }
          } else if (info.shareEncryptedDEK) {
            console.warn("[AudioTrackSyncer] Shared sidecars not yet supported in this hook.");
          }
        }

        if (info.isEncrypted && !sidecarDek) {
          throw new Error("Missing decryption key for audio track");
        }

        // 3. Fetch and Decrypt all chunks
        const chunks = await Promise.all(
          chunkUrls.map(async (url, i) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Chunk ${i} fetch failed`);
            const cipher = await res.arrayBuffer();

            if (!info.isEncrypted || !sidecarDek) return cipher;

            // Decrypt inline
            const ivB64 = chunkIvs[i];
            if (!ivB64) {
              throw new Error(`Missing IV for chunk ${i}`);
            }

            const { decryptChunk } = await import(
              "@/lib/crypto/fileEncryption"
            );
            
            try {
              return await decryptChunk(cipher, sidecarDek, ivB64);
            } catch (chunkDecError) {
              console.error(`[AudioTrackSyncer] AES-GCM decryption failed for chunk ${i}:`, chunkDecError);
              throw chunkDecError; // Rethrow to trigger the main catch block
            }
          }),
        );

        console.log(`[AudioTrackSyncer] All ${chunks.length} chunks decrypted. Combining...`);

        // 4. Combine into a single ArrayBuffer
        const totalLength = chunks.reduce((s, c) => s + c.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }

        // 5. Decode via AudioContext
        console.log("[AudioTrackSyncer] Decoding audio buffer...");
        const ctx = getAudioCtx();
        const audioBuffer = await ctx.decodeAudioData(combined.buffer);
        audioBlobRef.current = audioBuffer;

        // 6. Play synced
        playSynced(audioBuffer);
      } catch (err) {
        console.error("[AudioTrackSyncer] Failed to load sidecar track:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load audio track",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [dek, privateKey, metadataKey, playSynced],
  );

  // Public API: select a track by ID (null = use video's native audio)
  const selectTrack = useCallback(
    (trackId: string | null) => {
      stopSidecar();

      if (trackId === null) {
        // Re-enable native video audio
        if (videoElement) videoElement.muted = false;
        setActiveTrackId(null);
        return;
      }

      const track = audioTracks.find((t) => t.id === trackId);
      if (!track) return;

      setActiveTrackId(trackId);

      // Mute the video's native audio so sidecar takes over
      if (videoElement) videoElement.muted = true;

      if (!track.objectId) {
        // No sidecar stored yet — fall back to native
        if (videoElement) videoElement.muted = false;
        setActiveTrackId(null);
        return;
      }

      loadTrack(track);
    },
    [audioTracks, videoElement, stopSidecar, loadTrack],
  );

  // Re-sync when video seeks or buffers
  useEffect(() => {
    if (!videoElement || !audioBlobRef.current || activeTrackId === null) return;

    const onSeeked = () => {
      if (audioBlobRef.current) {
        playSynced(audioBlobRef.current);
      }
    };

    const handleBuffering = () => {
      const ctx = getAudioCtx();
      if (ctx.state === "running") ctx.suspend();
    };

    const handleResume = () => {
      const isActuallyPlaying =
        !videoElement.paused && videoElement.readyState >= 3;
      if (isActuallyPlaying) {
        const ctx = getAudioCtx();
        if (ctx.state === "suspended") ctx.resume();
      }
    };

    videoElement.addEventListener("seeked", onSeeked);
    videoElement.addEventListener("waiting", handleBuffering);
    videoElement.addEventListener("stalled", handleBuffering);
    videoElement.addEventListener("playing", handleResume);

    return () => {
      videoElement.removeEventListener("seeked", onSeeked);
      videoElement.removeEventListener("waiting", handleBuffering);
      videoElement.removeEventListener("stalled", handleBuffering);
      videoElement.removeEventListener("playing", handleResume);
    };
  }, [videoElement, activeTrackId, playSynced]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSidecar();
      audioCtxRef.current?.close();
    };
  }, [stopSidecar]);

  return { activeTrackId, isLoading, error, selectTrack };
}
