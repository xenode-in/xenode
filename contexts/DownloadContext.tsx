"use client";
"use client";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  decryptFile,
  decryptFileChunkedCombined,
} from "@/lib/crypto/fileEncryption";
import {
  getCachedSize,
  getCachedBytes,
  appendChunk,
  clearCache,
  getCachedIds,
  truncateCache,
} from "@/lib/downloadCache";

export interface DownloadTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  receivedBytes: number; // ADDED
  resumeFrom: number;
  status: "downloading" | "decrypting" | "paused" | "completed" | "failed";
  error?: string;
  abort?: () => void;
}

export interface PendingResume {
  id: string;
  name: string;
  cachedBytes: number;
}

interface DownloadContextType {
  tasks: DownloadTask[];
  pendingResumes: PendingResume[];
  startDownload: (
    obj: { id: string; key: string; size: number; contentType: string },
    isEncrypted: boolean,
    privateKey?: CryptoKey | null,
  ) => Promise<void>;
  cancelDownload: (id: string) => void;
  dismissResumes: () => void;
  removeTask: (id: string) => void;
  deleteDownload: (id: string) => Promise<void>;
  clearCompleted: () => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined,
);
const abortControllers = new Map<string, AbortController>();

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [pendingResumes, setPendingResumes] = useState<PendingResume[]>([]);

  useEffect(() => {
    getCachedIds().then(async (ids) => {
      if (ids.length === 0) return;
      const resumes: PendingResume[] = await Promise.all(
        ids.map(async (id) => {
          const cachedBytes = await getCachedSize(id);
          let name = id;
          try {
            const res = await fetch(`/api/objects/${id}`);
            if (res.ok) {
              const data = await res.json();
              name = (data.key as string)?.split("/").pop() ?? id;
            }
          } catch {}
          return { id, name, cachedBytes };
        }),
      );
      setPendingResumes(resumes);
    });
  }, []);

  const dismissResumes = useCallback(async () => {
    await Promise.all(pendingResumes.map((r) => clearCache(r.id)));
    setPendingResumes([]);
  }, [pendingResumes]);

  const updateTask = useCallback(
    (id: string, updates: Partial<Omit<DownloadTask, "abort">>) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      );
    },
    [],
  );

  const removeTask = useCallback((id: string) => {
    abortControllers.delete(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) =>
      prev.filter((t) => t.status !== "completed" && t.status !== "failed"),
    );
  }, []);

  const deleteDownload = useCallback(async (id: string) => {
    abortControllers.get(id)?.abort();
    abortControllers.delete(id);
    await clearCache(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setPendingResumes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const cancelDownload = useCallback(
    (id: string) => {
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      updateTask(id, { status: "paused" });
    },
    [updateTask],
  );

  const startDownload = useCallback(
    async (
      obj: { id: string; key: string; size: number; contentType: string },
      isEncrypted: boolean,
      privateKey?: CryptoKey | null,
    ) => {
      const name = obj.key.split("/").pop() || "download";
      const resumeFrom = isEncrypted ? await getCachedSize(obj.id) : 0;
      const controller = new AbortController();
      abortControllers.set(obj.id, controller);

      setTasks((prev) => [
        ...prev.filter((t) => t.id !== obj.id),
        {
          id: obj.id,
          name,
          size: obj.size,
          resumeFrom,
          receivedBytes: resumeFrom, // ADDED
          progress:
            resumeFrom && obj.size
              ? Math.round((resumeFrom / obj.size) * 100)
              : 0,
          status: "downloading",
        },
      ]);

      try {
        const res = await fetch(`/api/objects/${obj.id}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to get metadata");

        if (!isEncrypted) {
          if (data.chunkUrls && data.chunkUrls.length > 0) {
            // If non-encrypted but chunked, we have to stitch it... but xenode only chunks encrypted files.
            throw new Error(
              "Plaintext chunked files are not supported for download directly yet.",
            );
          } else if (data.url) {
            window.open(data.url, "_blank");
          }
          updateTask(obj.id, { status: "completed", progress: 100 });
          abortControllers.delete(obj.id);
          return;
        }

        if (!privateKey) throw new Error("Vault locked. Please unlock first.");

        const isChunked = !!(
          data.chunkUrls &&
          data.chunkUrls.length > 0 &&
          data.chunkSize &&
          data.chunkCount
        );
        let receivedLength = resumeFrom;

        if (!isChunked) {
          // Legacy single-blob file
          if (!data.url) throw new Error("Missing download URL");

          const fetchHeaders: Record<string, string> = {};
          if (resumeFrom > 0) {
            fetchHeaders["Range"] = `bytes=${resumeFrom}-`;
          }

          const ciphertextRes = await fetch(data.url, {
            headers: fetchHeaders,
            signal: controller.signal,
          });

          if (
            (!ciphertextRes.ok && ciphertextRes.status !== 206) ||
            !ciphertextRes.body
          ) {
            throw new Error("Failed to download file content");
          }

          const contentLength =
            +(ciphertextRes.headers.get("Content-Length") ?? 0) || 0;
          const totalSize = contentLength
            ? resumeFrom + contentLength
            : obj.size;
          const reader = ciphertextRes.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await appendChunk(obj.id, value);
            receivedLength += value.length;
            updateTask(obj.id, {
              receivedBytes: receivedLength, // ADDED
              progress: totalSize
                ? Math.round((receivedLength / totalSize) * 100)
                : 0,
            });
          }
        } else {
          // Multi-chunk encrypted file
          const cipherChunkSize = data.chunkSize + 16;
          const totalCipherSize =
            (data.chunkCount - 1) * cipherChunkSize +
            (obj.size - (data.chunkCount - 1) * data.chunkSize + 16);
            
          // Always resume from a complete-chunk boundary
          const resumeFromAligned = Math.floor(resumeFrom / cipherChunkSize) * cipherChunkSize;
          const startChunkIndex = resumeFromAligned / cipherChunkSize;
          const chunkOffset = 0; // Discard partial offsets

          if (resumeFrom > resumeFromAligned) {
            await truncateCache(obj.id, resumeFromAligned);
            receivedLength = resumeFromAligned;
            
            // Update UI state immediately to reflect truncated bytes
            updateTask(obj.id, {
              receivedBytes: receivedLength,
              resumeFrom: receivedLength,
              progress: totalCipherSize ? Math.round((receivedLength / totalCipherSize) * 100) : 0,
            });
          }

          // Process chunks concurrently
          const concurrency = 4;
          let currentIndex = startChunkIndex;

          // Queue for ordered appending
          const downloadedChunks = new Map<number, Uint8Array[]>();
          let nextIndexToAppend = startChunkIndex;
          let appendPromise = Promise.resolve(); // Shared promise chain

          const downloadWorker = async () => {
            while (currentIndex < data.chunkCount) {
              if (controller.signal.aborted) break;

              const i = currentIndex++;
              const chunkUrl = data.chunkUrls[i];
              const fetchHeaders: Record<string, string> = {};

              // chunkOffset is always 0 now, so this check could be removed, but kept for logic clarity
              if (i === startChunkIndex && chunkOffset > 0) {
                fetchHeaders["Range"] = `bytes=${chunkOffset}-`;
              }

              try {
                const chunkRes = await fetch(chunkUrl, {
                  headers: fetchHeaders,
                  signal: controller.signal,
                });
                if (
                  (!chunkRes.ok && chunkRes.status !== 206) ||
                  !chunkRes.body
                ) {
                  throw new Error(`Failed to download chunk ${i}`);
                }

                const reader = chunkRes.body.getReader();
                const chunks: Uint8Array[] = [];
                let chunkReceived = 0;
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                  chunkReceived += value.length;
                  receivedLength += value.length;

                  // Only update UI every 250kb or at the end to prevent overwhelming React state
                  if (chunkReceived > 250 * 1024) {
                    updateTask(obj.id, {
                      receivedBytes: receivedLength,
                      progress: totalCipherSize
                        ? Math.round((receivedLength / totalCipherSize) * 100)
                        : 0,
                    });
                    chunkReceived = 0;
                  }
                }

                // Final UI update for this chunk
                updateTask(obj.id, {
                  receivedBytes: receivedLength,
                  progress: totalCipherSize
                    ? Math.round((receivedLength / totalCipherSize) * 100)
                    : 0,
                });

                downloadedChunks.set(i, chunks);

                // Chain the append — only ONE append sequence runs at a time
                appendPromise = appendPromise.then(async () => {
                  while (downloadedChunks.has(nextIndexToAppend)) {
                    const orderedChunks =
                      downloadedChunks.get(nextIndexToAppend)!;
                    for (const c of orderedChunks) {
                      await appendChunk(obj.id, c);
                    }
                    downloadedChunks.delete(nextIndexToAppend);
                    nextIndexToAppend++;
                  }
                });
              } catch (e) {
                if (controller.signal.aborted) return;
                throw e;
              }
            }
          };

          const workers = Array.from(
            {
              length: Math.min(concurrency, data.chunkCount - startChunkIndex),
            },
            () => downloadWorker(),
          );
          await Promise.all(workers);
          await appendPromise; // CRITICAL: wait for all pending appends to finish
        }

        if (controller.signal.aborted) return;

        updateTask(obj.id, { status: "decrypting", progress: 100 });
        const cachedBytes = await getCachedBytes(obj.id);
        if (!cachedBytes) throw new Error("Cache lost after download");

        let decryptedBlob: Blob;
        if (isChunked) {
          decryptedBlob = await decryptFileChunkedCombined(
            cachedBytes.buffer as ArrayBuffer,
            data.encryptedDEK,
            data.chunkIvs,
            data.chunkSize,
            data.chunkCount,
            privateKey,
            data.contentType ?? obj.contentType,
          );
        } else {
          decryptedBlob = await decryptFile(
            cachedBytes.buffer as ArrayBuffer,
            data.encryptedDEK,
            data.iv,
            privateKey,
            data.contentType ?? obj.contentType,
          );
        }

        await clearCache(obj.id);

        const objectUrl = URL.createObjectURL(decryptedBlob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = name;
        document.body.appendChild(a); // Added: must append to DOM for click to work in some browsers
        a.click();
        document.body.removeChild(a); // Added: clean up
        URL.revokeObjectURL(objectUrl);

        updateTask(obj.id, { status: "completed" });
        abortControllers.delete(obj.id);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.log("Download error:", err);
        updateTask(obj.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
        abortControllers.delete(obj.id);
      }
    },
    [updateTask],
  );

  return (
    <DownloadContext.Provider
      value={{
        tasks,
        pendingResumes,
        startDownload,
        cancelDownload,
        dismissResumes,
        removeTask,
        deleteDownload,
        clearCompleted,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (context === undefined)
    throw new Error("useDownload must be used within a DownloadProvider");
  return context;
}
