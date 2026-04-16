"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  encryptFile,
  encryptFileChunked,
  encryptMetadataString,
  encryptMetadataObject,
  encryptThumbnail,
} from "@/lib/crypto/fileEncryption";
import { extractMetadata } from "@/lib/metadata/extractor";
import { toB64 } from "@/lib/crypto/utils";
import { optimizeVideoForStreaming } from "@/lib/video/faststart";
import { generatePreview } from "@/lib/images/optimizer";
import { upsertLocalObject } from "@/lib/db/object-cache";
import { extractSubtitleToVTT } from "@/lib/video/demuxer";
import { extractAudioTrack } from "@/lib/video/audio-extractor";

export interface UploadTask {
  id: string;
  file: File;
  bucketId: string;
  prefix: string;
  status: "pending" | "uploading" | "completed" | "failed";
  progress: number;
  error?: string;
}

interface UploadContextType {
  tasks: UploadTask[];
  addTasks: (files: File[], bucketId: string, prefix: string) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  clearCompleted: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const MAX_CONCURRENT_UPLOADS = 5;

// Helper to resize image and get base64
const generateThumbnail = (
  file: File,
): Promise<{ thumbnail: string; aspectRatio: number } | undefined> => {
  return new Promise((resolve) => {
    // Handle images (existing logic)
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const aspectRatio = img.width / img.height;
          const MAX_SIZE = 320;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, width, height);
            resolve({
              thumbnail: canvas.toDataURL("image/jpeg", 0.8),
              aspectRatio,
            });
          } else {
            resolve(undefined);
          }
        };
        img.onerror = () => resolve(undefined);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
      return;
    }

    // Handle videos
    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.playsInline = true;

      video.addEventListener("loadedmetadata", () => {
        // Seek to 10% of duration or 1s, whichever is smaller
        video.currentTime = Math.min(1, video.duration * 0.1);
      });

      video.addEventListener("seeked", () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 320;
        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        URL.revokeObjectURL(url);

          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            resolve({
              thumbnail: canvas.toDataURL("image/jpeg", 0.8),
              aspectRatio: video.videoWidth / video.videoHeight,
            });
          } else {
            resolve(undefined);
          }
      });

      video.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        resolve(undefined); // Resolve undefined, don't reject — thumbnail is optional
      });

      return;
    }

    resolve(undefined);
  });
};

/**
 * Compute chunk size based on file type and size.
 *
 * Streamable media (video/audio):
 *   - Chunks stay small so the first frame loads quickly via MediaSource.
 *   - < 100 MB  →  2 MB   (50 chunks max, instant start)
 *   - 100 MB–1 GB  →  4 MB   (balanced: ~250 chunks for 1 GB)
 *   - > 1 GB  →  8 MB   (still ~2-4 s first-chunk on 10 Mbps)
 *
 * Other files (archives, documents, etc.):
 *   - Optimize for upload throughput — fewer HTTP round-trips.
 *   - max(8 MB, fileSize / 100) capped at 64 MB
 */
function getAdaptiveChunkSize(fileSize: number, mimeType: string): number {
  const isStreamable =
    mimeType.startsWith("video/") || mimeType.startsWith("audio/");

  if (isStreamable) {
    if (fileSize < 100 * 1024 * 1024) return 2 * 1024 * 1024; // 2 MB
    if (fileSize < 1024 * 1024 * 1024) return 4 * 1024 * 1024; // 4 MB
    return 8 * 1024 * 1024; // 8 MB
  }
  // Non-streamable: bigger chunks, fewer requests
  const adaptive = Math.max(8 * 1024 * 1024, Math.floor(fileSize / 100));
  return Math.min(adaptive, 64 * 1024 * 1024);
}

function getMediaCategory(mimeType: string): string {
  if (!mimeType) return "other";
  mimeType = mimeType.toLowerCase();
  
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  
  if (mimeType.includes("pdf")) return "pdf";
  
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("xls") || mimeType.includes("csv")) return "excel";
  if (mimeType.includes("wordprocessing") || mimeType.includes("word") || mimeType.includes("doc")) return "word";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint") || mimeType.includes("ppt")) return "powerpoint";
  
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("rar") || mimeType.includes("7z") || mimeType.includes("archive")) return "archive";
  
  if (mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("html") || mimeType.includes("xml") || mimeType.includes("text/css") || mimeType.includes("text/x-") || mimeType.includes("application/x-sh")) return "code";

  if (mimeType.includes("document") || mimeType.includes("text/")) return "document";
  
  return "other";
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [activeUploads, setActiveUploads] = useState(0);
  const uploadingIds = useRef(new Set<string>());
  const uploadXHRs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const { publicKey: cryptoPublicKey, metadataKey: cryptoMetadataKey } =
    useCrypto();
  // Keep a ref so the useCallback below always reads the latest key
  // without needing to be re-created (avoids stale closure)
  const cryptoPublicKeyRef = useRef<CryptoKey | null>(null);
  cryptoPublicKeyRef.current = cryptoPublicKey;
  const cryptoMetadataKeyRef = useRef<CryptoKey | null>(null);
  cryptoMetadataKeyRef.current = cryptoMetadataKey;

  const uploadEncryptedThumbnail = useCallback(
    async (
      encryptedDataUrl: string,
      bucketId: string,
      fileStorageKey: string,
    ): Promise<string | undefined> => {
      try {
        const thumbKey = `${fileStorageKey}-thumb`;

        // Convert encrypted string to bytes for upload
        const bytes = new TextEncoder().encode(encryptedDataUrl);
        const blob = new Blob([bytes], { type: "application/octet-stream" });

        const presign = await fetch("/api/objects/presign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: `${fileStorageKey.split("/").pop()}-thumb`,
            fileSize: blob.size,
            fileType: "application/octet-stream",
            bucketId,
            prefix: fileStorageKey.includes("/")
              ? fileStorageKey.substring(0, fileStorageKey.lastIndexOf("/") + 1)
              : `users/${sessionRef.current?.user?.id}/`,
          }),
        });
        const { uploadUrl } = await presign.json();

        await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
        });

        return thumbKey;
      } catch (err) {
        console.error("Failed to upload thumbnail to B2:", err);
        return undefined;
      }
    },
    [],
  );

  /**
   * Determine whether we should encrypt this upload.
   * Requires BOTH:
   *  1. Vault is unlocked (publicKey in memory), AND
   *  2. User has opted in via User Model preference (session.user.encryptByDefault)
   */
  function shouldEncryptNow(): boolean {
    if (!cryptoPublicKeyRef.current) return false;
    // @ts-expect-error additionalFields
    return sessionRef.current?.user?.encryptByDefault || false;
  }

  // Prevent page reload/close during active uploads
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasActiveUploads = tasks.some(
        (t) => t.status === "uploading" || t.status === "pending",
      );

      if (hasActiveUploads) {
        e.preventDefault();
        e.returnValue = ""; // Chrome requires returnValue to be set
        return "You have uploads in progress. Are you sure you want to leave?";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [tasks]);

  const uploadChunkedMediaDirectly = useCallback(
    async (task: UploadTask) => {
      uploadingIds.current.add(task.id);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
        ),
      );

      try {
        let uploadFile = task.file;

        // Step 1: Optimize video for streaming (Faststart)
        if (task.file.type.startsWith("video/")) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    status: "uploading",
                    progress: 0,
                    error: "Optimizing video...",
                  }
                : t,
            ),
          );
          uploadFile = await optimizeVideoForStreaming(task.file);
        }

        const thumbResult = await generateThumbnail(uploadFile).catch(
          () => undefined,
        );
        const rawThumbnail = thumbResult?.thumbnail;
        const aspectRatio = thumbResult?.aspectRatio;
        let thumbnail: string | undefined;
        if (
          rawThumbnail &&
          cryptoMetadataKeyRef.current &&
          shouldEncryptNow()
        ) {
          thumbnail = await encryptThumbnail(
            rawThumbnail,
            cryptoMetadataKeyRef.current,
          ).catch(() => undefined);
        } else {
          thumbnail = rawThumbnail;
        }

        const chunkSize = getAdaptiveChunkSize(
          uploadFile.size,
          uploadFile.type,
        );
        let cipherChunkSize = chunkSize;
        let uploadBody: File | Blob = uploadFile;
        let uploadContentType = uploadFile.type || "application/octet-stream";
        let encryptedDEK: string | undefined;
        let encryptedName: string | undefined;
        let chunkCount = Math.ceil(uploadFile.size / chunkSize);
        let chunkIvs: string | undefined;

        let encryptedMetadata: string | undefined;
        let metadata: any = null;

        if (shouldEncryptNow()) {
          try {
            // Extract all metadata sources
            metadata = await extractMetadata(uploadFile, {
              thumbnail: rawThumbnail,
              aspectRatio,
              chunkSize,
              chunkCount,
              chunkIvs: JSON.parse(chunkIvs || "[]"),
            });

            console.log("METADATA", metadata);

            /*
            // Handle Subtitle Extraction & Sidecar Upload
            if (metadata.subtitleTracks && metadata.subtitleTracks.length > 0) {
              const updatedSubtitles = [];
              for (const track of metadata.subtitleTracks) {
                try {
                  const vttBlob = await extractSubtitleToVTT(uploadFile, track.id);
                  if (vttBlob) {
                    const sidecarFile = new File([vttBlob], `${uploadFile.name}-${track.language || track.id}.vtt`, { type: "text/vtt" });
                    
                    const sidecarEnc = await encryptFileChunked(
                      sidecarFile,
                      cryptoPublicKeyRef.current!,
                      1 * 1024 * 1024 // 1MB chunks for text
                    );

                    // Presign & Upload sidecar
                    const sidecarId = crypto.randomUUID();
                    const pre = await fetch("/api/objects/presign-upload-multipart", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fileName: sidecarId,
                        fileSize: sidecarEnc.ciphertext.size,
                        fileType: "application/octet-stream",
                        bucketId: task.bucketId,
                        prefix: task.prefix,
                        chunkCount: sidecarEnc.chunkCount,
                        chunkSize: sidecarEnc.chunkSize,
                      }),
                    });

                    if (pre.ok) {
                      const { fileId, urls, bucketId: stBucketData } = await pre.json();
                      const sidecarChunkUploads = [];
                      for (let i = 0; i < urls.length; i++) {
                        const start = i * sidecarEnc.chunkSize;
                        const end = Math.min(start + sidecarEnc.chunkSize, sidecarEnc.ciphertext.size);
                        const cBlob = sidecarEnc.ciphertext.slice(start, end);
                        await fetch(urls[i].url, { method: "PUT", body: cBlob });
                        sidecarChunkUploads.push({ index: i, key: urls[i].key, size: cBlob.size });
                      }
                      
                      const comp = await fetch("/api/objects/complete-upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          objectKey: fileId,
                          bucketId: stBucketData,
                          size: sidecarEnc.ciphertext.size,
                          contentType: "application/octet-stream",
                          originalContentType: "text/vtt",
                          mediaCategory: "document",
                          isEncrypted: true,
                          encryptedDEK: sidecarEnc.encryptedDEK,
                          encryptedName: await encryptMetadataString("subtitle.vtt", cryptoMetadataKeyRef.current!),
                          chunkSize: sidecarEnc.chunkSize,
                          chunkCount: sidecarEnc.chunkCount,
                          chunkIvs: JSON.stringify(sidecarEnc.chunkIvs),
                          isChunked: true,
                          chunks: sidecarChunkUploads,
                          // Optional: mark it hidden or sidecar so it doesn't show randomly in dashboard
                          isSidecar: true, 
                        }),
                      });

                      if (comp.ok) {
                        const result = await comp.json();
                        updatedSubtitles.push({ ...track, objectId: result.object._id });
                      } else {
                        updatedSubtitles.push(track);
                      }
                    } else {
                      updatedSubtitles.push(track);
                    }
                  } else {
                    updatedSubtitles.push(track);
                  }
                } catch (e) {
                  console.warn(`[E2EE] Failed to process subtitle track ${track.id}`, e);
                  updatedSubtitles.push(track);
                }
              }
              metadata.subtitleTracks = updatedSubtitles;
            }

            // Handle Audio Track Extraction & Sidecar Upload
            // Only extract extra tracks (index 1+). Track 0 stays native in the video.
            if (metadata.audioTracks && metadata.audioTracks.length > 1) {
              const updatedAudioTracks = [metadata.audioTracks[0]]; // keep track 0 as-is (native)

              for (let i = 1; i < metadata.audioTracks.length; i++) {
                const track = metadata.audioTracks[i];
                try {
                  const audioBlob = await extractAudioTrack(uploadFile, i, track.language || `track${i}`);

                  if (audioBlob) {
                    const sidecarFile = new File(
                      [audioBlob],
                      `${uploadFile.name}-audio-${track.language || i}.m4a`,
                      { type: "audio/mp4" },
                    );

                    const sidecarEnc = await encryptFileChunked(
                      sidecarFile,
                      cryptoPublicKeyRef.current!,
                      2 * 1024 * 1024, // 2MB chunks
                    );

                    const sidecarId = crypto.randomUUID();
                    const pre = await fetch("/api/objects/presign-upload-multipart", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fileName: sidecarId,
                        fileSize: sidecarEnc.ciphertext.size,
                        fileType: "application/octet-stream",
                        bucketId: task.bucketId,
                        prefix: task.prefix,
                        chunkCount: sidecarEnc.chunkCount,
                        chunkSize: sidecarEnc.chunkSize,
                      }),
                    });

                    if (pre.ok) {
                      const { fileId, urls, bucketId: stBucketData } = await pre.json();
                      const audioChunkUploads = [];

                      for (let ci = 0; ci < urls.length; ci++) {
                        const start = ci * sidecarEnc.chunkSize;
                        const end = Math.min(start + sidecarEnc.chunkSize, sidecarEnc.ciphertext.size);
                        const cBlob = sidecarEnc.ciphertext.slice(start, end);
                        await fetch(urls[ci].url, { method: "PUT", body: cBlob });
                        audioChunkUploads.push({ index: ci, key: urls[ci].key, size: cBlob.size });
                      }

                      const comp = await fetch("/api/objects/complete-upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          objectKey: fileId,
                          bucketId: stBucketData,
                          size: sidecarEnc.ciphertext.size,
                          contentType: "application/octet-stream",
                          originalContentType: "audio/aac",
                          mediaCategory: "audio",
                          isEncrypted: true,
                          encryptedDEK: sidecarEnc.encryptedDEK,
                          encryptedName: await encryptMetadataString(
                            `${track.language || `track${i}`}.aac`,
                            cryptoMetadataKeyRef.current!,
                          ),
                          chunkSize: sidecarEnc.chunkSize,
                          chunkCount: sidecarEnc.chunkCount,
                          chunkIvs: JSON.stringify(sidecarEnc.chunkIvs),
                          isChunked: true,
                          chunks: audioChunkUploads,
                          isSidecar: true,
                          // parentObjectId will be patched after main upload completes
                        }),
                      });

                      if (comp.ok) {
                        const result = await comp.json();
                        updatedAudioTracks.push({ ...track, objectId: result.object._id });
                      } else {
                        updatedAudioTracks.push(track);
                      }
                    } else {
                      updatedAudioTracks.push(track);
                    }
                  } else {
                    updatedAudioTracks.push(track);
                  }
                } catch (e) {
                  console.warn(`[E2EE] Failed to extract audio track ${i}`, e);
                  updatedAudioTracks.push(track);
                }
              }

              metadata.audioTracks = updatedAudioTracks;
            }
            */

            // Encrypt standardized metadata object
            encryptedMetadata = await encryptMetadataObject(
              metadata,
              cryptoMetadataKeyRef.current!,
            );

            // Legacy backward-compatibility headers (optional but kept for safety)
            encryptedName = await encryptMetadataString(
              uploadFile.name,
              cryptoMetadataKeyRef.current!,
            );

            const enc = await encryptFileChunked(
              uploadFile,
              cryptoPublicKeyRef.current!,
              chunkSize,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            chunkCount = enc.chunkCount;
            chunkIvs = JSON.stringify(enc.chunkIvs);
            cipherChunkSize = chunkSize + 16;
          } catch (err) {
            console.warn(
              "[E2EE] Encryption failed, falling back to plaintext",
              err,
            );
            uploadBody = uploadFile;
            uploadContentType = uploadFile.type || "application/octet-stream";
            encryptedDEK = undefined;
            encryptedName = undefined;
            chunkIvs = undefined;
            chunkCount = Math.ceil(uploadFile.size / chunkSize);
          }
        }

        const presignResponse = await fetch(
          "/api/objects/presign-upload-multipart",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: shouldEncryptNow()
                ? crypto.randomUUID()
                : task.file.name,
              fileSize: uploadBody.size,
              fileType: uploadContentType,
              bucketId: task.bucketId,
              prefix: task.prefix,
              chunkCount,
              chunkSize,
            }),
          },
        );

        if (!presignResponse.ok) {
          const error = await presignResponse.json();
          throw new Error(error.error || "Failed to get multipart upload URLs");
        }

        const {
          fileId,
          urls,
          bucketId: returnedBucketId,
          chunkSize: serverChunkSize,
        } = await presignResponse.json();

        // Handle thumbnail upload to B2
        let thumbnailKey: string | undefined;
        if (thumbnail && thumbnail.startsWith("enc:")) {
          thumbnailKey = await uploadEncryptedThumbnail(
            thumbnail,
            returnedBucketId,
            fileId,
          );
        }

        const chunkUploads: { index: number; key: string; size: number }[] = [];
        const loadedBytes = new Array(urls.length).fill(0);
        const totalSize = uploadBody.size;

        // Limit concurrency
        const concurrency = 4; // Bump concurrency to 4
        let urlIndex = 0;

        const uploadWorker = async () => {
          while (urlIndex < urls.length) {
            const currentIndex = urlIndex++;
            const urlObj = urls[currentIndex];
            const start = currentIndex * cipherChunkSize;
            const end = Math.min(start + cipherChunkSize, totalSize);
            const chunkBlob = uploadBody.slice(start, end);

            await new Promise<void>((resolve, reject) => {
              const xhr = new XMLHttpRequest();

              xhr.upload.addEventListener("progress", (e) => {
                if (e.lengthComputable) {
                  loadedBytes[currentIndex] = e.loaded;
                  const totalLoaded = loadedBytes.reduce((a, b) => a + b, 0);
                  const progress = Math.round((totalLoaded / totalSize) * 100);
                  setTasks((prev) =>
                    prev.map((t) =>
                      t.id === task.id ? { ...t, progress } : t,
                    ),
                  );
                }
              });

              xhr.addEventListener("load", () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  loadedBytes[currentIndex] = chunkBlob.size;
                  chunkUploads.push({
                    index: currentIndex,
                    key: urlObj.key,
                    size: chunkBlob.size,
                  });
                  resolve();
                } else {
                  reject(
                    new Error(
                      `Chunk upload failed: ${xhr.status} - ${xhr.statusText}`,
                    ),
                  );
                }
              });

              xhr.addEventListener("error", () =>
                reject(new Error("Network error during chunk upload")),
              );
              xhr.addEventListener("abort", () =>
                reject(new Error("Upload aborted")),
              );

              xhr.open("PUT", urlObj.url);
              xhr.setRequestHeader("Content-Type", uploadContentType);
              xhr.send(chunkBlob);
            });
          }
        };

        const workers = Array.from(
          { length: Math.min(concurrency, urls.length) },
          () => uploadWorker(),
        );
        await Promise.all(workers);

        // Sort chunkUploads by index just in case
        chunkUploads.sort((a, b) => a.index - b.index);

        const completeResponse = await fetch("/api/objects/complete-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectKey: fileId,
            bucketId: returnedBucketId,
            size: totalSize,
            contentType: shouldEncryptNow()
              ? "application/octet-stream"
              : uploadFile.type,
            originalContentType: uploadFile.type,
            mediaCategory: getMediaCategory(uploadFile.type),
            encryptedContentType:
              shouldEncryptNow() && cryptoMetadataKeyRef.current
                ? await encryptMetadataString(
                    uploadFile.type,
                    cryptoMetadataKeyRef.current,
                  )
                : undefined,
            thumbnail: thumbnailKey || thumbnail, // Use thumbnailKey if available, otherwise original thumbnail
            isEncrypted: !!encryptedDEK,
            encryptedDEK,
            encryptedName,
            chunkSize: serverChunkSize,
            chunkCount: urls.length,
            chunkIvs,
            isChunked: true,
            chunks: chunkUploads,
            encryptedMetadata,
            aspectRatio,
          }),
        });

        if (!completeResponse.ok) {
          const error = await completeResponse.json();
          throw new Error(error.error || "Failed to save file metadata");
        }

        const completeData = await completeResponse.json();
        const mainObjectId = completeData.object?._id;
        await upsertLocalObject(
          sessionRef.current?.user?.id,
          completeData.object,
          returnedBucketId,
        );

        /*
        // Patch sidecar objects (audio and subtitles) with parentObjectId now that we have the main object's ID
        if (mainObjectId && metadata) {
          const tracks = [
            ...(metadata.audioTracks || []),
            ...(metadata.subtitleTracks || [])
          ];
          
          for (const track of tracks) {
            if ((track as any).objectId) {
              await fetch(`/api/objects/complete-upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  objectKey: (track as any).objectId, // pass the sidecar's ID as key to look it up
                  parentObjectId: mainObjectId,
                  // minimal fields — API will do a find-and-update via objectKey matching
                }),
              }).catch(() => {});
            }
          }
        }
        */

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: "completed", progress: 100 } : t,
          ),
        );
      } catch (error) {
        console.error("Upload error:", error);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: "failed",
                  error:
                    error instanceof Error ? error.message : "Upload failed",
                }
              : t,
          ),
        );
      } finally {
        uploadingIds.current.delete(task.id);
        setActiveUploads((prev) => prev - 1);
      }
    },
    [uploadEncryptedThumbnail],
  );

  const uploadFileDirectly = useCallback(async (task: UploadTask) => {
    // Prevent double upload (React Strict Mode)
    if (uploadingIds.current.has(task.id)) {
      return;
    }

    if (
      task.file.type.startsWith("video/") ||
      task.file.type.startsWith("audio/")
    ) {
      uploadChunkedMediaDirectly(task);
      return;
    }

    uploadingIds.current.add(task.id);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
      ),
    );

    try {
      const thumbResult = await generateThumbnail(task.file).catch(
        () => undefined,
      );
      const rawThumbnail = thumbResult?.thumbnail;
      const aspectRatioFromThumb = thumbResult?.aspectRatio;

      let thumbnail: string | undefined;
      if (rawThumbnail && cryptoMetadataKeyRef.current && shouldEncryptNow()) {
        thumbnail = await encryptThumbnail(
          rawThumbnail,
          cryptoMetadataKeyRef.current,
        ).catch(() => undefined);
      } else {
        thumbnail = rawThumbnail;
      }

      // Step 1: Get presigned URL from server
      const presignResponse = await fetch("/api/objects/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // For encrypted uploads, use a UUID key so the real name is hidden
          fileName: shouldEncryptNow() ? crypto.randomUUID() : task.file.name,
          fileSize: task.file.size,
          fileType: shouldEncryptNow()
            ? "application/octet-stream"
            : task.file.type,
          bucketId: task.bucketId,
          prefix: task.prefix,
        }),
      });

      if (!presignResponse.ok) {
        const error = await presignResponse.json();
        throw new Error(error.error || "Failed to get upload URL");
      }

      const {
        uploadUrl,
        objectKey,
        bucketId: returnedBucketId,
      } = await presignResponse.json();

      // Step 2: Generate preview for images
      let optimizedFile: File | null = null;
      let optimizedObjectKey: string | undefined;
      let optimizedUploadUrl: string | undefined;
      let aspectRatio = aspectRatioFromThumb;

      if (
        task.file.type.startsWith("image/") ||
        [
          "heic",
          "heif",
          "cr2",
          "cr3",
          "nef",
          "nrw",
          "arw",
          "srf",
          "dng",
          "raf",
          "rw2",
          "orf",
          "pef",
        ].includes(task.file.name.split(".").pop()?.toLowerCase() ?? "")
      ) {
        try {
          const { preview, original, aspectRatio: previewAR } = await generatePreview(
            task.file,
          );
          if (previewAR) aspectRatio = previewAR;

          if (preview !== original && preview.size < task.file.size) {
            optimizedFile = preview;

            const optPresignRes = await fetch("/api/objects/presign-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileName: shouldEncryptNow()
                  ? crypto.randomUUID()
                  : optimizedFile.name,
                fileSize: optimizedFile.size,
                fileType: shouldEncryptNow()
                  ? "application/octet-stream"
                  : optimizedFile.type,
                bucketId: task.bucketId,
                prefix: task.prefix,
              }),
            });

            if (optPresignRes.ok) {
              const optData = await optPresignRes.json();
              optimizedObjectKey = optData.objectKey;
              optimizedUploadUrl = optData.uploadUrl;
            }
          }
        } catch (err) {
          console.warn(
            "[Preview] Generation failed, skipping optimized version",
            err,
          );
        }
      }

      // Step 3: Encrypt file if vault is unlocked, otherwise upload plaintext
      let uploadBody: File | Blob = task.file;
      let uploadContentType = task.file.type || "application/octet-stream";
      let encryptedDEK: string | undefined;
      let encryptedIV: string | undefined;
      let encryptedName: string | undefined;
      // Chunked encryption fields (video/audio only)
      let chunkSize: number | undefined;
      let chunkCount: number | undefined;
      let chunkIvs: string | undefined; // JSON string

      let encryptedMetadata: string | undefined;

      if (shouldEncryptNow()) {
        try {
          const isStreamable =
            task.file.type.startsWith("video/") ||
            task.file.type.startsWith("audio/");

          // Common Metadata Extraction
          const metadata = await extractMetadata(task.file, {
            thumbnail: rawThumbnail,
          });

          if (isStreamable) {
            const enc = await encryptFileChunked(
              task.file,
              cryptoPublicKeyRef.current!,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            chunkSize = enc.chunkSize;
            chunkCount = enc.chunkCount;
            chunkIvs = JSON.stringify(enc.chunkIvs);

            // Update metadata with chunk info
            metadata.chunkSize = chunkSize;
            metadata.chunkCount = chunkCount;
            metadata.chunkIvs = enc.chunkIvs;
          } else {
            const enc = await encryptFile(
              task.file,
              cryptoPublicKeyRef.current!,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            encryptedIV = enc.iv;
          }

          // Encrypt standardized metadata object
          encryptedMetadata = await encryptMetadataObject(
            {
              ...metadata,
              aspectRatio,
            },
            cryptoMetadataKeyRef.current!,
          );

          // Legacy fields for backward compatibility
          encryptedName = await encryptMetadataString(
            task.file.name,
            cryptoMetadataKeyRef.current!,
          );
        } catch (err) {
          console.warn(
            "[E2EE] Encryption failed, falling back to plaintext",
            err,
          );
          uploadBody = task.file;
          uploadContentType = task.file.type || "application/octet-stream";
          encryptedDEK = undefined;
          encryptedIV = undefined;
          encryptedName = undefined;
          chunkSize = undefined;
          chunkCount = undefined;
          chunkIvs = undefined;
        }
      }

      // Step 4: Handle thumbnail upload to B2
      let thumbnailKey: string | undefined;
      if (thumbnail && thumbnail.startsWith("enc:")) {
        thumbnailKey = await uploadEncryptedThumbnail(
          thumbnail,
          returnedBucketId,
          objectKey,
        );
      }

      // Step 5: Encrypt and Upload optimized version if exists
      let optimizedIV: string | undefined;
      let optimizedSize: number | undefined;
      let optimizedEncryptedDEK: string | undefined;

      if (optimizedFile && optimizedUploadUrl && optimizedObjectKey) {
        let optBody: Blob = optimizedFile;
        optimizedSize = optimizedFile.size;

        if (shouldEncryptNow()) {
          const enc = await encryptFile(
            optimizedFile,
            cryptoPublicKeyRef.current!,
          );
          optBody = enc.ciphertext;
          optimizedIV = enc.iv;
          optimizedEncryptedDEK = enc.encryptedDEK;
        }

        await fetch(optimizedUploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": shouldEncryptNow()
              ? "application/octet-stream"
              : optimizedFile.type,
          },
          body: optBody,
        });
      }

      // Step 6: Upload main file to B2 with XHR for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXHRs.current.set(task.id, xhr);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setTasks((prev) =>
              prev.map((t) => (t.id === task.id ? { ...t, progress } : t)),
            );
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `Upload to B2 failed: ${xhr.status} - ${xhr.statusText}`,
              ),
            );
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Network error during upload"));
        });

        xhr.addEventListener("abort", () => {
          reject(new Error("Upload aborted"));
        });

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", uploadContentType);
        xhr.send(uploadBody);
      });

      // Step 4: Notify server of completion
      const completeResponse = await fetch("/api/objects/complete-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey,
          bucketId: returnedBucketId,
          size: uploadBody instanceof Blob ? uploadBody.size : task.file.size,
          contentType: shouldEncryptNow()
            ? "application/octet-stream"
            : task.file.type,
          originalContentType: task.file.type,
          mediaCategory: getMediaCategory(task.file.type),
          encryptedContentType:
            shouldEncryptNow() && cryptoMetadataKeyRef.current
              ? await encryptMetadataString(
                  task.file.type,
                  cryptoMetadataKeyRef.current,
                )
              : undefined,
          thumbnail: thumbnailKey || thumbnail, // Use thumbnailKey if available, otherwise original thumbnail
          isEncrypted: !!encryptedDEK,
          encryptedDEK,
          iv: encryptedIV,
          encryptedName,
          chunkSize,
          chunkCount,
          chunkIvs,
          encryptedMetadata,
          optimizedKey: optimizedObjectKey,
          optimizedSize,
          optimizedContentType: optimizedFile?.type,
          optimizedIV,
          optimizedEncryptedDEK,
          aspectRatio,
        }),
      });

      if (!completeResponse.ok) {
        const error = await completeResponse.json();
        throw new Error(error.error || "Failed to save file metadata");
      }

      const completeData = await completeResponse.json();
      await upsertLocalObject(
        sessionRef.current?.user?.id,
        completeData.object,
        returnedBucketId,
      );

      // Mark as completed
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "completed", progress: 100 } : t,
        ),
      );
    } catch (error) {
      console.error("Upload error:", error);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: "failed",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : t,
        ),
      );
    } finally {
      uploadingIds.current.delete(task.id);
      uploadXHRs.current.delete(task.id);
      setActiveUploads((prev) => prev - 1);
    }
  }, []);

  const processQueue = useCallback(() => {
    setTasks((currentTasks) => {
      const pending = currentTasks.filter((t) => t.status === "pending");
      const canStart = MAX_CONCURRENT_UPLOADS - activeUploads;

      if (canStart > 0 && pending.length > 0) {
        const toStart = pending.slice(0, canStart);
        toStart.forEach((task) => {
          setActiveUploads((prev) => prev + 1);
          uploadFileDirectly(task);
        });
      }

      return currentTasks;
    });
  }, [activeUploads, uploadFileDirectly]);

  const addTasks = useCallback(
    (files: File[], bucketId: string, prefix: string) => {
      const newTasks: UploadTask[] = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        bucketId,
        prefix,
        status: "pending",
        progress: 0,
      }));

      setTasks((prev) => [...prev, ...newTasks]);

      // Process queue after state update
      setTimeout(processQueue, 0);
    },
    [processQueue],
  );

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const cancelTask = useCallback((id: string) => {
    const xhr = uploadXHRs.current.get(id);
    if (xhr) {
      xhr.abort();
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: "failed", error: "Upload cancelled" } : t,
      ),
    );
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== "completed"));
  }, []);

  // Auto-process queue when active uploads decrease
  React.useEffect(() => {
    if (activeUploads < MAX_CONCURRENT_UPLOADS) {
      processQueue();
    }
  }, [activeUploads, processQueue]);

  return (
    <UploadContext.Provider
      value={{ tasks, addTasks, removeTask, cancelTask, clearCompleted }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within UploadProvider");
  }
  return context;
}
