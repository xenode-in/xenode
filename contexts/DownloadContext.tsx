"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { decryptFile } from "@/lib/crypto/fileEncryption";
import {
  getCachedSize,
  getCachedBytes,
  appendChunk,
  clearCache,
  getCachedIds,
} from "@/lib/downloadCache";

export interface DownloadTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  /** How many bytes are already cached from a previous attempt */
  resumeFrom: number;
  status: "downloading" | "decrypting" | "paused" | "completed" | "failed";
  error?: string;
  /** Call this to abort an in-progress download (saves cache for next resume) */
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

// Keep AbortControllers outside React state (no re-renders)
const abortControllers = new Map<string, AbortController>();

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [pendingResumes, setPendingResumes] = useState<PendingResume[]>([]);

  // On mount: scan IndexedDB for any interrupted downloads from a previous session
  useEffect(() => {
    getCachedIds().then(async (ids) => {
      if (ids.length === 0) return;
      const resumes: PendingResume[] = await Promise.all(
        ids.map(async (id) => {
          const cachedBytes = await getCachedSize(id);
          // Try to get the file name from the API metadata
          let name = id;
          try {
            const res = await fetch(`/api/objects/${id}`);
            if (res.ok) {
              const data = await res.json();
              name = (data.key as string)?.split("/").pop() ?? id;
            }
          } catch {
            // Use ID as fallback name
          }
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
    // Abort if active
    abortControllers.get(id)?.abort();
    abortControllers.delete(id);

    // Wipe any persisted chunks
    await clearCache(id);

    // Remove from UI state
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setPendingResumes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const cancelDownload = useCallback(
    (id: string) => {
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      // Leave cache in place — status → "paused" so Resume button appears
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

      // Check IndexedDB for previously saved bytes
      const resumeFrom = isEncrypted ? await getCachedSize(obj.id) : 0;

      // Register the task (or replace an existing one)
      const controller = new AbortController();
      abortControllers.set(obj.id, controller);

      setTasks((prev) => [
        ...prev.filter((t) => t.id !== obj.id),
        {
          id: obj.id,
          name,
          size: obj.size,
          resumeFrom,
          progress:
            resumeFrom && obj.size
              ? Math.round((resumeFrom / obj.size) * 100)
              : 0,
          status: "downloading",
        },
      ]);

      try {
        // ── Metadata ──────────────────────────────────────────────────────
        const res = await fetch(`/api/objects/${obj.id}`, {
          signal: controller.signal,
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Failed to get metadata");

        // ── Plaintext shortcut ────────────────────────────────────────────
        if (!isEncrypted) {
          if (data.url) window.open(data.url, "_blank");
          updateTask(obj.id, { status: "completed", progress: 100 });
          abortControllers.delete(obj.id);
          return;
        }

        // ── Encrypted download ────────────────────────────────────────────
        if (!privateKey) throw new Error("Vault locked. Please unlock first.");

        // Build request headers — send Range if we have cached bytes
        const fetchHeaders: Record<string, string> = {};
        if (resumeFrom > 0) {
          fetchHeaders["Range"] = `bytes=${resumeFrom}-`;
          console.log(`[Download] Resuming ${name} from byte ${resumeFrom}`);
        }

        const ciphertextRes = await fetch(`/api/objects/${obj.id}/content`, {
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
        // Total expected size = already cached + remainder being streamed now
        const totalSize = contentLength ? resumeFrom + contentLength : obj.size;

        const reader = ciphertextRes.body.getReader();
        let receivedLength = resumeFrom; // start counting from resume point

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Persist chunk immediately so it survives an abort
          await appendChunk(obj.id, value);
          receivedLength += value.length;

          const progress = totalSize
            ? Math.round((receivedLength / totalSize) * 100)
            : 0;
          updateTask(obj.id, { progress });
        }

        // ── Decrypt ───────────────────────────────────────────────────────
        updateTask(obj.id, { status: "decrypting", progress: 100 });

        // Reconstruct full ciphertext from cache (includes bytes from prior runs)
        const cachedBytes = await getCachedBytes(obj.id);
        if (!cachedBytes) throw new Error("Cache lost after download");

        const decryptedBlob = await decryptFile(
          cachedBytes.buffer as ArrayBuffer,
          data.encryptedDEK,
          data.iv,
          privateKey,
          data.contentType ?? obj.contentType,
        );

        // Clean up cache now that we have plaintext
        await clearCache(obj.id);

        // Trigger browser save
        const objectUrl = URL.createObjectURL(decryptedBlob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = name;
        a.click();
        URL.revokeObjectURL(objectUrl);

        updateTask(obj.id, { status: "completed" });
        abortControllers.delete(obj.id);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled — cache stays, status already set to "paused" by cancelDownload
          return;
        }
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
  if (context === undefined) {
    throw new Error("useDownload must be used within a DownloadProvider");
  }
  return context;
}
