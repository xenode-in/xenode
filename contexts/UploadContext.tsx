"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

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
  clearCompleted: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const MAX_CONCURRENT_UPLOADS = 5;

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [activeUploads, setActiveUploads] = useState(0);

  const uploadFile = useCallback(async (task: UploadTask) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: "uploading" } : t)),
    );

    try {
      const formData = new FormData();
      formData.append("file", task.file);
      formData.append("bucketId", task.bucketId);
      formData.append("prefix", task.prefix);

      const xhr = new XMLHttpRequest();

      // Track progress
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, progress } : t)),
          );
        }
      });

      // Handle completion
      await new Promise<void>((resolve, reject) => {
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? { ...t, status: "completed", progress: 100 }
                  : t,
              ),
            );
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Network error"));
        });

        xhr.open("POST", "/api/objects/upload");
        xhr.send(formData);
      });
    } catch (error) {
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
          uploadFile(task);
        });
      }

      return currentTasks;
    });
  }, [activeUploads, uploadFile]);

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
      value={{ tasks, addTasks, removeTask, clearCompleted }}
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
