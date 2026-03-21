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
import { encryptFile, encryptFileChunked, buildAad, encryptMetadataString } from "@/lib/crypto/fileEncryption";
import { toB64, CRYPTO_VERSION } from "@/lib/crypto/utils";

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
const generateThumbnail = (file: File): Promise<string | undefined> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(undefined);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 320; // Increased from 100 for better quality (Google Drive style)
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
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        } else {
          resolve(undefined);
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
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
    if (fileSize < 100 * 1024 * 1024) return 2 * 1024 * 1024;        // 2 MB
    if (fileSize < 1024 * 1024 * 1024) return 4 * 1024 * 1024;       // 4 MB
    return 8 * 1024 * 1024;                                           // 8 MB
  }

  // Non-streamable: bigger chunks, fewer requests
  const adaptive = Math.max(8 * 1024 * 1024, Math.floor(fileSize / 100));
  return Math.min(adaptive, 64 * 1024 * 1024);
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [activeUploads, setActiveUploads] = useState(0);
  const uploadingIds = useRef(new Set<string>());
  const uploadXHRs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const { publicKey: cryptoPublicKey, metadataKey: cryptoMetadataKey } = useCrypto();
  // Keep a ref so the useCallback below always reads the latest key
  // without needing to be re-created (avoids stale closure)
  const cryptoPublicKeyRef = useRef<CryptoKey | null>(null);
  cryptoPublicKeyRef.current = cryptoPublicKey;
  const cryptoMetadataKeyRef = useRef<CryptoKey | null>(null);
  cryptoMetadataKeyRef.current = cryptoMetadataKey;

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

  const uploadChunkedMediaDirectly = useCallback(async (task: UploadTask) => {
    uploadingIds.current.add(task.id);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: "uploading", progress: 0 } : t,
      ),
    );

    try {
      let thumbnail: string | undefined;
      try {
        thumbnail = await generateThumbnail(task.file);
      } catch (err) {
        console.warn("Failed to generate thumbnail", err);
      }

      const chunkSize = getAdaptiveChunkSize(task.file.size, task.file.type);
      let cipherChunkSize = chunkSize;
      const objectKey = shouldEncryptNow() ? crypto.randomUUID() : (task.file.name);
      const isEncrypted = shouldEncryptNow();

      let uploadBody: File | Blob = task.file;
      let uploadContentType = task.file.type || "application/octet-stream";
      let encryptedDEK: string | undefined;
      let encryptedName: string | undefined;
      let chunkCount = Math.ceil(task.file.size / chunkSize);
      let chunkIvs: string | undefined;

      if (isEncrypted) {
        // Build AAD for chunked upload (base params)
        const aadBase = {
          userId: sessionRef.current!.user.id,
          bucketId: task.bucketId,
          objectKey, // UUID
        };

        const enc = await encryptFileChunked(
          task.file,
          cryptoPublicKeyRef.current!,
          aadBase,
          chunkSize
        );
        uploadBody = enc.ciphertext;
        uploadContentType = "application/octet-stream";
        encryptedDEK = enc.encryptedDEK;
        chunkCount = enc.chunkCount;
        chunkIvs = JSON.stringify(enc.chunkIvs);
        cipherChunkSize = chunkSize + 16;

        // Metadata AAD (version 2)
        const metadataAad = buildAad({ ...aadBase, version: CRYPTO_VERSION });
        encryptedName = await encryptMetadataString(
          task.file.name,
          cryptoMetadataKeyRef.current!,
          metadataAad,
        );
      }

      const presignResponse = await fetch("/api/objects/presign-upload-multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: objectKey,
          fileSize: uploadBody.size,
          fileType: uploadContentType,
          bucketId: task.bucketId,
          prefix: task.prefix,
          chunkCount,
          chunkSize,
        }),
      });

      if (!presignResponse.ok) {
        const error = await presignResponse.json();
        throw new Error(error.error || "Failed to get multipart upload URLs");
      }

      const { fileId, urls, bucketId: returnedBucketId, chunkSize: serverChunkSize } = await presignResponse.json();
      
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
                  prev.map((t) => (t.id === task.id ? { ...t, progress } : t)),
                );
              }
            });

            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                loadedBytes[currentIndex] = chunkBlob.size;
                chunkUploads.push({
                  index: currentIndex,
                  key: urlObj.key,
                  size: chunkBlob.size
                });
                resolve();
              } else {
                reject(new Error(`Chunk upload failed: ${xhr.status} - ${xhr.statusText}`));
              }
            });

            xhr.addEventListener("error", () => reject(new Error("Network error during chunk upload")));
            xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

            xhr.open("PUT", urlObj.url);
            xhr.setRequestHeader("Content-Type", uploadContentType);
            xhr.send(chunkBlob);
          });
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => uploadWorker());
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
          contentType: task.file.type,
          thumbnail,
          isEncrypted: !!encryptedDEK,
          cryptoVersion: isEncrypted ? CRYPTO_VERSION : undefined,
          encryptedDEK,
          encryptedName,
          chunkSize: serverChunkSize,
          chunkCount: urls.length,
          chunkIvs,
          isChunked: true,
          chunks: chunkUploads,
        }),
      });

      if (!completeResponse.ok) {
        const error = await completeResponse.json();
        throw new Error(error.error || "Failed to save file metadata");
      }

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
      setActiveUploads((prev) => prev - 1);
    }
  }, []);

  const uploadFileDirectly = useCallback(async (task: UploadTask) => {
    // Prevent double upload (React Strict Mode)
    if (uploadingIds.current.has(task.id)) {
      return;
    }

    if (task.file.type.startsWith("video/") || task.file.type.startsWith("audio/")) {
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
      // Step 0: Generate thumbnail if image
      let thumbnail: string | undefined;
      try {
        thumbnail = await generateThumbnail(task.file);
      } catch (err) {
        console.warn("Failed to generate thumbnail", err);
      }

      const objectKey = shouldEncryptNow() ? crypto.randomUUID() : task.file.name;
      const isEncrypted = shouldEncryptNow();

      // Step 1: Get presigned URL from server
      const presignResponse = await fetch("/api/objects/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: objectKey,
          fileSize: task.file.size,
          fileType: isEncrypted ? "application/octet-stream" : task.file.type,
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
        objectKey: returnedObjectKey,
        bucketId: returnedBucketId,
      } = await presignResponse.json();

      // Step 2: Encrypt file if vault is unlocked
      let uploadBody: File | Blob = task.file;
      let uploadContentType = task.file.type || "application/octet-stream";
      let encryptedDEK: string | undefined;
      let encryptedIV: string | undefined;
      let encryptedName: string | undefined;
      let chunkSize: number | undefined;
      let chunkCount: number | undefined;
      let chunkIvs: string | undefined;

      if (isEncrypted) {
        // Build base AAD
        const aadBase = {
          userId: sessionRef.current!.user.id,
          bucketId: task.bucketId,
          objectKey: returnedObjectKey, // UUID
        };

        const isStreamable =
          task.file.type.startsWith("video/") ||
          task.file.type.startsWith("audio/");

        if (isStreamable) {
          const enc = await encryptFileChunked(
            task.file,
            cryptoPublicKeyRef.current!,
            aadBase
          );
          uploadBody = enc.ciphertext;
          uploadContentType = "application/octet-stream";
          encryptedDEK = enc.encryptedDEK;
          chunkSize = enc.chunkSize;
          chunkCount = enc.chunkCount;
          chunkIvs = JSON.stringify(enc.chunkIvs);
        } else {
          const fileAad = buildAad({ ...aadBase, chunkIndex: 0, totalChunks: 1 });
          const enc = await encryptFile(
            task.file,
            cryptoPublicKeyRef.current!,
            fileAad
          );
          uploadBody = enc.ciphertext;
          uploadContentType = "application/octet-stream";
          encryptedDEK = enc.encryptedDEK;
          encryptedIV = enc.iv;
        }

        // Metadata AAD (version 2)
        const metadataAad = buildAad({ ...aadBase, version: CRYPTO_VERSION });
        encryptedName = await encryptMetadataString(
          task.file.name,
          cryptoMetadataKeyRef.current!,
          metadataAad
        );
      }

      // Step 3: Upload to B2 with XHR for progress tracking
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
          objectKey: returnedObjectKey,
          bucketId: returnedBucketId,
          size: uploadBody instanceof Blob ? uploadBody.size : task.file.size,
          contentType: task.file.type,
          thumbnail,
          isEncrypted: !!encryptedDEK,
          cryptoVersion: isEncrypted ? CRYPTO_VERSION : undefined,
          encryptedDEK,
          iv: encryptedIV,
          encryptedName,
          chunkSize,
          chunkCount,
          chunkIvs,
        }),
      });

      if (!completeResponse.ok) {
        const error = await completeResponse.json();
        throw new Error(error.error || "Failed to save file metadata");
      }

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
