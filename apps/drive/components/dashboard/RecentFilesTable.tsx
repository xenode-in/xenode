"use client";
import Link from "next/link";
import {
  MoreHorizontal,
  Lock,
  DownloadCloud,
  Link2,
  FileText,
} from "lucide-react";
import { getFileIcon } from "@/lib/file-icons";
import { formatBytes, formatDate } from "@/lib/utils";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  decryptMetadataString,
  unwrapStoredFileKey,
} from "@/lib/crypto/fileEncryption";
import { useState, useEffect } from "react";
import { usePreview } from "@/contexts/PreviewContext";
import { useDownload } from "@/contexts/DownloadContext";
import { ShareDialog, ShareableFile } from "@/components/share-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ObjectData {
  id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
  thumbnail?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  mediaCategory?: string;
  encryptedContentType?: string;
  encryptedDisplayName?: string;
}

function getFileName(key: string) {
  return key.split("/").pop() || key;
}

interface RecentFilesTableProps {
  files: ObjectData[];
}

export function RecentFilesTable({ files }: RecentFilesTableProps) {
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const { isUnlocked, metadataKey, privateKey, setModalOpen } = useCrypto();
  const { openPreview } = usePreview();
  const { startDownload } = useDownload();
  const [shareFile, setShareFile] = useState<ShareableFile | null>(null);

  /** Personal files only; extractable so the share dialog can re-wrap it. */
  async function getFileKey(fileId: string): Promise<CryptoKey> {
    if (!privateKey) {
      setModalOpen(true);
      throw new Error("Vault locked");
    }
    const res = await fetch(`/api/objects/${fileId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to get file metadata");
    return unwrapStoredFileKey(data, fileId, { privateKey }, true);
  }

  // Locking (or an empty list) drops every decrypted name.
  if ((!isUnlocked || !files.length) && Object.keys(decryptedNames).length) {
    setDecryptedNames({});
  }

  useEffect(() => {
    if (!isUnlocked || !files.length) return;
    let cancelled = false;

    const decryptNames = async () => {
      const newNames: Record<string, string> = {};
      for (const file of files) {
        if (
          file.isEncrypted &&
          file.encryptedName &&
          metadataKey &&
          !decryptedNames[file.id]
        ) {
          try {
            const name = await decryptMetadataString(
              file.encryptedName,
              metadataKey,
              { fileId: file.id, purpose: "name" },
            );
            newNames[file.id] = name;
          } catch (e) {
            console.error("Failed to decrypt name", e);
          }
        }
      }
      if (!cancelled && Object.keys(newNames).length > 0) {
        setDecryptedNames((prev) => ({ ...prev, ...newNames }));
      }
    };

    void decryptNames();
    return () => {
      cancelled = true;
    };
  }, [files, isUnlocked]);

  if (files.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Files</h2>
        <Link
          href="/dashboard/files"
          className="text-xs text-primary hover:underline"
        >
          View all files
        </Link>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_40px] gap-4 px-4 py-2 border-b border-border">
          <span className="text-xs text-muted-foreground">Name</span>
          <span className="text-xs text-muted-foreground">Size</span>
          <span className="text-xs text-muted-foreground">Last Modified</span>
          <span className="text-xs text-muted-foreground text-right">
            Action
          </span>
        </div>

        {/* Rows */}
        {files.map((file) => (
          <div
            key={file.id}
            onClick={() => openPreview(file, { sourceContext: "owned", intent: "preview" })}
            className="grid grid-cols-[2fr_1fr_1fr_40px] gap-4 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors items-center cursor-pointer group"
          >
            {/* Name */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                {getFileIcon(file.contentType, "w-4 h-4", file.mediaCategory)}
              </div>
              <span className="text-sm text-foreground truncate">
                {decryptedNames[file.id] ||
                  file.encryptedName ||
                  getFileName(file.key)}
              </span>
            </div>

            {/* Size */}
            <span className="text-sm text-muted-foreground">
              {formatBytes(file.size)}
            </span>

            {/* Last Modified */}
            <span className="text-sm text-muted-foreground">
              {new Date(file.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>

            {/* Action */}
            <div
              className="ml-auto flex items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-secondary transition-colors">
                    <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48 bg-card border-border"
                >
                  <DropdownMenuItem
                    className="hover:bg-accent cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPreview(file, { sourceContext: "owned", intent: "preview" });
                    }}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Preview
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="hover:bg-accent cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      startDownload(file, !!file.isEncrypted, privateKey, metadataKey);
                    }}
                  >
                    <DownloadCloud className="w-4 h-4 mr-2" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="hover:bg-accent cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShareFile(file);
                    }}
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Share
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      {shareFile && (
        <ShareDialog
          file={shareFile}
          open={!!shareFile}
          onOpenChange={(isOpen) => !isOpen && setShareFile(null)}
          getFileKey={getFileKey}
        />
      )}
    </div>
  );
}
