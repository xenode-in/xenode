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
  name?: string;
}

interface PreviewContextType {
  previewFile: ObjectData | null;
  isPreviewOpen: boolean;
  openPreview: (file: ObjectData, fileList?: ObjectData[]) => void;
  closePreview: () => void;
}

const PreviewContext = createContext<PreviewContextType | undefined>(undefined);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [previewFile, setPreviewFile] = useState<ObjectData | null>(null);
  const [currentFileList, setCurrentFileList] = useState<ObjectData[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const openPreview = (file: ObjectData, fileList?: ObjectData[]) => {
    setPreviewFile(file);
    setCurrentFileList(fileList || []);
    setIsPreviewOpen(true);
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
  };

  const currentIndex = previewFile && currentFileList ? currentFileList.findIndex(f => f.id === previewFile.id) : -1;
  const hasNext = currentIndex !== -1 && currentIndex < currentFileList.length - 1;
  const hasPrevious = currentIndex !== -1 && currentIndex > 0;

  const handleNext = () => {
    if (hasNext) {
      setPreviewFile(currentFileList[currentIndex + 1]);
    }
  };

  const handlePrevious = () => {
    if (hasPrevious) {
      setPreviewFile(currentFileList[currentIndex - 1]);
    }
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
          onNext={handleNext}
          onPrevious={handlePrevious}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
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
