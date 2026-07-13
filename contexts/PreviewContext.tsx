"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import dynamic from "next/dynamic";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";

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
  mediaCategory?: string;
  bucketId?: string;
}

interface PreviewContextType {
  previewFile: ObjectData | null;
  isPreviewOpen: boolean;
  openPreview: (file: ObjectData, fileList?: ObjectData[]) => void;
  closePreview: () => void;
}

const PreviewContext = createContext<PreviewContextType | undefined>(undefined);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const workspace = useOptionalWorkspace();
  const [previewFile, setPreviewFile] = useState<ObjectData | null>(null);
  const [currentFileList, setCurrentFileList] = useState<ObjectData[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const openPreview = (file: ObjectData, fileList?: ObjectData[]) => {
    const type = file.contentType.toLowerCase();
    const name = (file.name || "").toLowerCase();
    const isSpreadsheet =
      file.mediaCategory === "excel" ||
      type.includes("spreadsheet") ||
      type.includes("excel") ||
      type.includes("csv") ||
      /\.(xlsx|xls|csv)$/.test(name);

    if (isSpreadsheet) {
      const params = new URLSearchParams({ id: file.id });
      const scope = workspace?.driveScope;
      if (scope?.type === "organization" || scope?.type === "team") {
        params.set("orgId", scope.orgId);
      }
      if (scope?.type === "team") params.set("teamId", scope.teamId);
      if (file.bucketId) params.set("bucketId", file.bucketId);
      const slash = file.key.lastIndexOf("/");
      if (slash >= 0) params.set("prefix", file.key.slice(0, slash + 1));
      window.location.assign("/sheets/editor?" + params.toString());
      return;
    }

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
