"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useCrypto } from "@/contexts/CryptoContext";
import { encryptFile, encryptFileChunked } from "@/lib/crypto/fileEncryption";
import { toB64 } from "@/lib/crypto/utils";

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

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [activeUploads, setActiveUploads] = useState(0);
  const uploadingIds = useRef(new Set<string>());
  const uploadXHRs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const { publicKey: cryptoPublicKey } = useCrypto();
  // Keep a ref so the useCallback below always reads the latest key
  // without needing to be re-created (avoids stale closure)
  const cryptoPublicKeyRef = useRef<CryptoKey | null>(null);
  cryptoPublicKeyRef.current = cryptoPublicKey;

  /**
   * Determine whether we should encrypt this upload.
   * Requires BOTH:
   *  1. Vault is unlocked (publicKey in memory), AND
   *  2. User has opted in via Settings toggle (localStorage pref)
   */
  function shouldEncryptNow(): boolean {
    if (!cryptoPublicKeyRef.current) return false;
    try {
      return localStorage.getItem("xenode.encryptUploads") === "true";
    } catch {
      return false;
    }
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

  const uploadFileDirectly = useCallback(async (task: UploadTask) => {
    // Prevent double upload (React Strict Mode)
    if (uploadingIds.current.has(task.id)) {
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

      // Step 2: Encrypt file if vault is unlocked, otherwise upload plaintext
      let uploadBody: File | Blob = task.file;
      let uploadContentType = task.file.type || "application/octet-stream";
      let encryptedDEK: string | undefined;
      let encryptedIV: string | undefined;
      let encryptedName: string | undefined;
      // Chunked encryption fields (video/audio only)
      let chunkSize: number | undefined;
      let chunkCount: number | undefined;
      let chunkIvs: string | undefined; // JSON string

      if (shouldEncryptNow()) {
        try {
          const isStreamable =
            task.file.type.startsWith("video/") ||
            task.file.type.startsWith("audio/");

          if (isStreamable) {
            // Chunked AES-GCM — enables true browser streaming at preview time
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
            // No single iv for chunked files
          } else {
            // Single-blob AES-GCM for non-streamable files
            const enc = await encryptFile(
              task.file,
              cryptoPublicKeyRef.current!,
            );
            uploadBody = enc.ciphertext;
            uploadContentType = "application/octet-stream";
            encryptedDEK = enc.encryptedDEK;
            encryptedIV = enc.iv;
          }

          // Encrypt the original filename (shared by both paths)
          const nameBuf = new TextEncoder().encode(task.file.name);
          const nameKey = crypto.getRandomValues(new Uint8Array(32));
          const nameIV = crypto.getRandomValues(new Uint8Array(12));
          const encNameBuf = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nameIV as Uint8Array<ArrayBuffer> },
            await crypto.subtle.importKey(
              "raw",
              nameKey as Uint8Array<ArrayBuffer>,
              { name: "AES-GCM", length: 256 },
              false,
              ["encrypt"],
            ),
            nameBuf,
          );
          const combined = new Uint8Array(
            nameKey.byteLength + nameIV.byteLength + encNameBuf.byteLength,
          );
          combined.set(nameKey, 0);
          combined.set(nameIV, nameKey.byteLength);
          combined.set(
            new Uint8Array(encNameBuf),
            nameKey.byteLength + nameIV.byteLength,
          );
          encryptedName = toB64(combined);
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
          objectKey,
          bucketId: returnedBucketId,
          size: uploadBody instanceof Blob ? uploadBody.size : task.file.size,
          contentType: task.file.type,
          thumbnail,
          isEncrypted: !!encryptedDEK,
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
