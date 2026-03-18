"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import dynamic from "next/dynamic";

const FilePreviewDialog = dynamic(
  () =>
    import("@/components/dashboard/FilePreviewDialog").then(
      (mod) => mod.FilePreviewDialog,
    ),
  { ssr: false },
);

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  tags?: string[];
  position?: number;
  thumbnail?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
}

interface PreviewContextType {
  previewFile: ObjectData | null;
  isPreviewOpen: boolean;
  openPreview: (file: ObjectData) => void;
  closePreview: () => void;
}

const PreviewContext = createContext<PreviewContextType | undefined>(undefined);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [previewFile, setPreviewFile] = useState<ObjectData | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const openPreview = (file: ObjectData) => {
    setPreviewFile(file);
    setIsPreviewOpen(true);
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
  };

  return (
    <PreviewContext.Provider
      value={{ previewFile, isPreviewOpen, openPreview, closePreview }}
    >
      {children}
      {previewFile && (
        <FilePreviewDialog
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={closePreview}
        />
      )}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error("usePreview must be used within a PreviewProvider");
  }
  return context;
}
